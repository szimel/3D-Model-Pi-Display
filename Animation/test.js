import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import Stats from 'three/addons/libs/stats.module.js';
import Tween, { Easing } from 'https://unpkg.com/@tweenjs/tween.js@23.1.3/dist/tween.esm.js';

// global vars for threejs/scene
let scene, camera, renderer, stats, brush, chair, cane, points, AnimationData, index = 0;

// --- SHADERS (The "Scripts" for the GPU) ---
const particleVertexShader = `
  uniform float uCyclePos;
  uniform float uPointSize;

  attribute vec3 pos0; // Chair
  attribute vec3 pos1; // Brush
  attribute vec3 pos2; // Cane

  varying float vHump;

  float easeInOutCubic(float t){
    return t < 0.5
      ? 4.0 * t * t * t
      : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
  }

  float hump01(float t){
    return sin(3.14159265 * clamp(t, 0.0, 1.0));
  }

  // simple hash -> stable "random" from position (cheap, no attribute)
  float hash13(vec3 p){
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  void main() {
    vec3 a, b;
    float tLeg;

    // choose endpoints + local t in [0..1]
    if (uCyclePos < 1.0) {
      a = pos0; b = pos1; tLeg = uCyclePos;
    } else if (uCyclePos < 2.0) {
      a = pos1; b = pos2; tLeg = uCyclePos - 1.0;
    } else {
      a = pos2; b = pos0; tLeg = uCyclePos - 2.0;
    }

    // ---------- HEIGHT STAGGER ----------
    // Tunables:
    float minY = -0.1;   // adjust to your models
    float maxY =  .9;   // adjust to your models
    float maxDelay = 0.65; // 0.2 subtle, 0.45 strong

    // normalize start height to 0..1
    float h = clamp((a.y - minY) / (maxY - minY), 0.0, 1.0);

    // bottom->top wipe: delay = h * maxDelay
    // top->bottom wipe: delay = (1.0 - h) * maxDelay
    float delay = h * maxDelay;

    // add a tiny jitter so it doesn't look like perfect scanlines
    float jitter = (hash13(a) - 0.5) * 0.06; // +/- 3% of leg time
    delay = clamp(delay + jitter, 0.0, maxDelay);

    // compress time so everyone still arrives at the end
    float tt = clamp((tLeg - delay) / (1.0 - maxDelay), 0.0, 1.0);

    // nice easing
    tt = easeInOutCubic(tt);

    // hump for size and mid-flight effects
    vHump = hump01(tt);

    // ---------- CURVED PATH (cheap) ----------
    // Start with linear
    vec3 p = mix(a, b, tt);

    // Curve that peaks mid-flight:
    // We'll offset perpendicular-ish to the travel direction.
    vec3 dir = normalize(b - a + vec3(1e-6));
    vec3 up  = vec3(0.0, 1.0, 0.0);

    // if dir is almost parallel to up, pick a different axis to avoid zero cross
    vec3 axis = abs(dot(dir, up)) > 0.9 ? vec3(1.0, 0.0, 0.0) : up;
    vec3 side = normalize(cross(dir, axis));

    // amplitude: small by default; add per-point variety via hash
    float ampBase = 0.065;                      // global curve amount
    float ampVar  = 0.04 * (hash13(a * 3.1));   // 0..0.04
    float amp = ampBase + ampVar;

    // offset peaks at mid-flight, zero at endpoints
    p += side * (vHump * amp);

    // Optional: add a second “lift” arc (slight upward arc mid-flight)
    p += vec3(0.0, 1.0, 0.0) * (vHump * 0.02);

    // final position
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // ---------- SIZE EASING ----------
    float boost = 1.0; // peak = 2x
    float size = uPointSize * (1.0 + boost * vHump);
    gl_PointSize = clamp(size, 1.0, 6.0);
  }
`;

const particleFragmentShader = `
  uniform vec3 uColor0;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform float uCyclePos;
  uniform float uOpacity;

  varying float vHump;

  void main() {
    vec3 baseColor;

    // same leg logic, but use local leg t
    if (uCyclePos < 1.0) {
      baseColor = mix(uColor0, uColor1, uCyclePos);
    } else if (uCyclePos < 2.0) {
      baseColor = mix(uColor1, uColor2, uCyclePos - 1.0);
    } else {
      baseColor = mix(uColor2, uColor0, uCyclePos - 2.0);
    }

    // --- COLOR RAMP / POP ---
    // 1) brighten mid-leg
    float brighten = 0.5;                 // 0..1 (try 0.2–0.8)
    vec3 color = baseColor * (1.0 + brighten * vHump);

    // 2) optional: add a slight “hot” tint mid-leg (feels sparkly)
    // Set tintStrength to 0.0 if you don't want it.
    vec3 tint = vec3(1.0, 0.9, 0.6);      // warm highlight
    float tintStrength = 0.25;            // try 0.0–0.5
    color = mix(color, color * tint, tintStrength * vHump);

    // Optional: soften point edges so they look like particles not pixels
    // (cheap circular sprite falloff)
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    float alpha = uOpacity * smoothstep(1.0, 0.0, r2); // fades to edges
		alpha *= (0.6 + 0.4 * vHump);


    gl_FragColor = vec4(color, alpha);
  }
`;


// Pre-collected materials for fast fade
const fadeNodes = {
  model: [[], [], []], // [chairMats, brushMats, caneMats]
};

function collectMats(root) {
  const out = [];
  root.traverse((n) => {
    if (!n.isMesh || !n.material) return;
    if (Array.isArray(n.material)) out.push(...n.material.filter(Boolean));
    else out.push(n.material);
  });
  return out;
}

function createFadeNodes() {
  fadeNodes.model[0] = collectMats(chair); // index 0 = chair
  fadeNodes.model[1] = collectMats(brush); // index 1 = brush
  fadeNodes.model[2] = collectMats(cane);  // index 2 = cane
}


// removes unwanted mesh's from buffer/memory or something like that
function disposeMesh(object) {
    if (!object) return;
    // 1. Remove from scene graph
    object.parent.remove(object);
    
    // 2. Dispose of geometry and material to prevent memory leaks
    if (object.geometry) object.geometry.dispose();
    
    // If material is an array or single object
    if (object.material) {
        if (Array.isArray(object.material)) {
            object.material.forEach(mat => mat.dispose());
        } else {
            object.material.dispose();
        }
    }
}

function setup() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xD2B48C); // tan

  stats = new Stats(); // fps thing
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(stats.dom);

  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 10);
  camera.position.set(1.5, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(5, 5, 5);
  scene.add(dir);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// --- load & set json and glb's --- \\
async function loadAssets() {
  try {
    const loader = new GLTFLoader();
    const [json, chairGLB, brushGLB, caneGLB] = await Promise.all([
      fetch('./path-data.json').then((r) => r.json()),
      loader.loadAsync('../Models/stool_3.glb'),
      loader.loadAsync('../Models/brush_2.glb'),
			loader.loadAsync('../Models/cane3.glb'),
    ]);

    AnimationData = json;
    chair = chairGLB.scene;
    brush = brushGLB.scene;
		cane = caneGLB.scene;


    chair.name = 'chair';
    brush.name = 'brush';
		cane.name = 'cane';

    // Make materials fade-able + avoid depth artifacts
    chair.traverse((n) => {
      if (n.isMesh && n.material) {
        n.material.transparent = true;
        n.material.depthTest = true;
      }
    });
    brush.traverse((n) => {
      if (n.isMesh && n.material) {
        n.material.transparent = true;
        n.material.depthTest = true;
      }
    });
		cane.traverse((n) => {
      if (n.isMesh && n.material) {
        n.material.transparent = true;
        n.material.depthTest = true;
      }
    });

    // Flatten brush matrices (same as your original)
    brush.updateMatrixWorld(true);
    brush.traverse((node) => {
      if (node.isMesh) {
        node.updateMatrix();
        node.geometry.applyMatrix4(node.matrix);
        node.matrix.identity();
        node.position.set(0, 0, 0);
        node.rotation.set(0, 0, 0);
        node.scale.set(1, 1, 1);
      }
    });

    brush.scale.set(1, 1, 1);
    brush.position.set(0, 0, 0);
    brush.rotation.x = THREE.MathUtils.degToRad(90);
    brush.visible = false;

		// chair.position.set(0, 1.5, 0);
    chair.visible = true;

		// Setup for cane is different than others. 5 total meshes. Need to combine 
		// #'s 3 and 4, and delete 1 and 5 (they are texture's and we don't use those). 
		// combine 3 and 4 means making new mesh and deleting old ones. 
		// remove first and last: 
		const parent = cane.children[0];
		const meshes = parent.children;
		const first = meshes[0];
		const last = meshes[meshes.length - 1];
		const merge1 = meshes[2];
		const merge2 = meshes[3];

		disposeMesh(first);
		disposeMesh(last);

		// merge 3 and 4 together (now 2 and 3). Note: they have the same material
		merge1.geometry.applyMatrix4(merge1.matrix);
		merge2.geometry.applyMatrix4(merge2.matrix);
		const mergedGeometry = BufferGeometryUtils.mergeGeometries([merge1.geometry, merge2.geometry]);
		const mergedMesh = new THREE.Mesh(mergedGeometry, merge1.material);

		// can remove merged meshes and add new one
		disposeMesh(merge1);
		disposeMesh(merge2);
		parent.add(mergedMesh);

		// fix coloring on both meshes
		parent.children[0].material.color.setRGB(.65, .65, .65);
		parent.children[0].material.metalness = 0;
		
		// gold highlights for cane
		parent.children[1].material.color.set("#D4AF37"); 

		cane.position.set(0,-.35,0)

    scene.add(chair, brush, cane);
    console.log('scene', AnimationData.path.length, scene);
  } catch (err) {
    console.error('Error loading glb model:', err);
  }
}

// --- create model particles for transition --- \\
function createParticles() {
  const counts = { main: 10000, accent: 2000 };
	
  // Format: [ChairColor, BrushColor, CaneColor]
  const mainColors = [0xf8f8ff, 0xcc9000, 0xBFBFBD]; // White, Orange, Grey
  const accentColors = [0x111111, 0x111111, 0xD4AF37]; // Black, Black, Gold

  // Grab the meshes
  const chairMainMesh = chair.children[0].children[0];
  const chairAccentMesh = chair.children[0].children[1];
  const brushMainMesh = brush.children[0];
  const brushAccentMesh = brush.children[1];
	const caneMainMesh = cane.children[0].children[0];
	const caneAccentMesh = cane.children[0].children[1];

	// idk what this does
  const sampler = {
    chairMain: new MeshSurfaceSampler(chairMainMesh).build(),
    chairAccent: new MeshSurfaceSampler(chairAccentMesh).build(),
    brushMain: new MeshSurfaceSampler(brushMainMesh).build(),
    brushAccent: new MeshSurfaceSampler(brushAccentMesh).build(),
		caneMain: new MeshSurfaceSampler(caneMainMesh).build(),
		caneAccent: new MeshSurfaceSampler(caneAccentMesh).build(),
  };

	// grabs random points on whichever mesh surfaces it's passed
	function samplePoints(mesh, surfSampler, N) {
		const array = new Float32Array(N * 3);
		const v = new THREE.Vector3();

		// make sure matrixWorld is current
		mesh.updateWorldMatrix(true, false);

		for (let i = 0; i < N; i++) {
			surfSampler.sample(v);
			v.applyMatrix4(mesh.matrixWorld);
			array.set([v.x, v.y, v.z], i * 3);
		}
		return array;
	}

	function makePointCloud(count, colors, meshA, meshB, meshC) {
		const samplerA = new MeshSurfaceSampler(meshA).build();
		const samplerB = new MeshSurfaceSampler(meshB).build();
		const samplerC = new MeshSurfaceSampler(meshC).build();

		const p0 = samplePoints(meshA, samplerA, count);
		const p1 = samplePoints(meshB, samplerB, count);
		const p2 = samplePoints(meshC, samplerC, count);

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(p0, 3));
		geometry.setAttribute('pos0', new THREE.BufferAttribute(p0, 3));
		geometry.setAttribute('pos1', new THREE.BufferAttribute(p1, 3));
		geometry.setAttribute('pos2', new THREE.BufferAttribute(p2, 3));
		geometry.computeBoundingSphere();

		const material = new THREE.ShaderMaterial({
			uniforms: {
				uCyclePos: { value: 0.0 },
				uPointSize: { value: 3 },
				uColor0: { value: new THREE.Color(colors[0]) },
				uColor1: { value: new THREE.Color(colors[1]) },
				uColor2: { value: new THREE.Color(colors[2]) },
				uOpacity: { value: 1.0 },
			},
			vertexShader: particleVertexShader,
			fragmentShader: particleFragmentShader,
			transparent: true,
			depthTest: true,
			depthWrite: false,
		});

		const point = new THREE.Points(geometry, material);

		point.visible = true;
		return point;
	}

	const pointsM = makePointCloud(counts.main, mainColors, chairMainMesh, brushMainMesh, caneMainMesh);
	const pointsA = makePointCloud(counts.accent, accentColors, chairAccentMesh, brushAccentMesh, caneAccentMesh);

  points = new THREE.Group();
  points.add(pointsM, pointsA);

  // reduce depth artifacts
  points.children.forEach((p) => {
    p.material.transparent = true;
    p.material.depthTest = true;
    p.material.depthWrite = false;
  });

  scene.add(points);
}

// Continuous render loop
function animate(time) {
  requestAnimationFrame(animate);
  stats.update();
  Tween.update(time);
  renderer.render(scene, camera);
}

// Camera path tween
function animationTween(N) {
  // run duration: roughly N frames at 60fps
  const dur = Math.max(500, Math.round(N / 60) * 1000);

  return new Tween.Tween({ i: 0 })
    .to({ i: N - 1 }, dur)
    .onUpdate(({ i }) => {
      i = Math.round(i);
      const frame = AnimationData.path[i];
      if (!frame) return;

      const { x, y, z } = frame;
      camera.position.set(x, y, z);
      camera.lookAt(brush.position); // ALWAYS in exact center => always look at it
    });
}

// Fade a model ↔ points
function fadeTween(model, modelIndex, shouldFade) {
  const modelMats = fadeNodes.model[modelIndex];
	const easing = shouldFade ? Easing.Cubic.In : Easing.Cubic.Out;

  return new Tween.Tween({ t: 0 })
    .to({ t: 1 }, 3000)
    .easing(easing)
    .onStart(() => {
      // only flip vis when this tween actually begins
      model.visible = true;
      points.visible = true;

      // important: while fading, never let the model write depth
			// todo: figure out why this fixes and breaks animation
      modelMats.forEach((m) => (m.depthWrite = false));
			// points.children.forEach((p) => (p.material.depthWrite = false, p.material.transparent = true))
    })
    .onUpdate(({ t }) => {
      const modelOpacity = shouldFade ? 1 - t : t;
      const pointsOpacity = 1 - modelOpacity;

      modelMats.forEach((mat) => {
        mat.opacity = modelOpacity;
        mat.depthWrite = modelOpacity >= 0.7;
      });

			points.children.forEach((p) => {
				p.material.uniforms.uOpacity.value = pointsOpacity;
			});
    })
    .onComplete(() => {
      if (shouldFade) {
        model.visible = false;
        points.visible = true;
      } else {
        points.visible = false;
        model.visible = true;
      }
    });
}



// nextIndex is 0, 1, or 2
function transitionTween(targetIndex) {
  // Access the point material uniforms
  // Assuming 'points' is your global group
  const mainMat = points.children[0].material; 
  const accentMat = points.children[1].material;

  // HANDLE THE WRAP AROUND (2 -> 0)
  // If we are at 2 (Cane) and going to 0 (Chair), we actually want to tween to 3.
  // The shader treats 3.0 as 0.0
  let endValue = targetIndex;
  if (mainMat.uniforms.uCyclePos.value >= 1.9 && targetIndex === 0) {
      endValue = 3.0;
  }
  
  // Optional: If we just finished a loop (at 3.0), reset silently to 0.0
  if (mainMat.uniforms.uCyclePos.value >= 2.9) {
      mainMat.uniforms.uCyclePos.value = 0.0;
      accentMat.uniforms.uCyclePos.value = 0.0;
  }
  
  const startVal = mainMat.uniforms.uCyclePos.value;

  return new Tween.Tween({ t: startVal })
    .to({ t: endValue }, 6000)
    .easing(Easing.Linear.None)
    .onUpdate(({ t }) => {
    	// Update the GPU uniform
      mainMat.uniforms.uCyclePos.value = t;
      accentMat.uniforms.uCyclePos.value = t;
      
			const theta = 2 * Math.PI * t;
			camera.position.set(
				1.5 * Math.cos(theta),
				0,
				1.5 * Math.sin(theta),
			);
			camera.lookAt(brush.position);
    })
    .onComplete(() => {
        // Ensure exact snap
        mainMat.uniforms.uCyclePos.value = endValue;
        accentMat.uniforms.uCyclePos.value = endValue;
    });
}


// The full loop: camera animation -> fade current model out + fade points in -> points morph -> fade next model in + fade points out
function runCycle() {
	const currentIdx = index; // 0, 1, or 2
  const nextIdx = (currentIdx + 1) % 3; // Loops 0 -> 1 -> 2 -> 0
	const models = [chair, brush, cane];

	const currentModel = models[currentIdx];
  const nextModel = models[nextIdx];

  // Build tweens
  const t1 = animationTween(AnimationData.path.length);
  const t2 = fadeTween(currentModel, currentIdx, true);
  const t3 = transitionTween(nextIdx);
  const t4 = fadeTween(nextModel, nextIdx, false);

  t1.chain(t2);
  t2.chain(t3);
  t3.chain(t4);

  t4.onComplete(() => {
		index = nextIdx;
    runCycle();
  });

  t1.start();
}

// --- load everything in order --- \\
init();
async function init() {
  setup();
  await loadAssets();
  createParticles();
  createFadeNodes();

	// addUI();
	camera.lookAt(brush.position);

  // initial visibility / opacity state
  chair.visible = true;
  brush.visible = false;
	cane.visible = false;
	points.visible = false;

  fadeNodes.model[0].forEach((m) => (m.opacity = 1));
  fadeNodes.model[1].forEach((m) => (m.opacity = 0));
	fadeNodes.model[2].forEach((m) => (m.opacity = 0));
	points.children.forEach((p) => {
		p.material.uniforms.uOpacity.value = 0.0;
	});

  animate();
  runCycle();
}


// --- Old helper functions --
// function addUI() {
//   // minimal styles: bottom-right, out of the way
//   const style = document.createElement('style');
//   style.textContent = `
//     .ui-panel{
//       position:fixed; right:16px; bottom:16px; z-index:9999;
//       display:grid; gap:8px; padding:10px; border-radius:10px;
//       background:rgba(0,0,0,.55); color:#fff; font:500 13px/1 system-ui, sans-serif;
//       user-select:none;
//     }
//     .ui-panel button{
//       min-width:140px; padding:8px 10px; border-radius:8px; border:0; cursor:pointer;
//       background:rgba(255,255,255,.1); color:#fff;
//     }
//     .ui-panel button:hover{ background:rgba(255,255,255,.18); }
//   `;
//   document.head.appendChild(style);

//   const panel = document.createElement('div');
//   panel.className = 'ui-panel';

//   // buttons
//   const bChair = document.createElement('button');
//   bChair.textContent = 'Show Chair';
//   bChair.onclick = () => {
// 		if (chair) { chair.visible = !chair.visible; }
//   };

//   const bBrush = document.createElement('button');
//   bBrush.textContent = 'Show Brush';
//   bBrush.onclick = () => {
// 		if (brush) { brush.visible = !brush.visible; }
//   };
// 	const bCane = document.createElement('button');
//   bCane.textContent = 'Show Cane';
//   bCane.onclick = () => {
// 		if (cane) { cane.visible = !cane.visible; }
//   };

// 	const bCaneMesh = document.createElement('button');
// 	bCaneMesh.textContent = 'cycle mesh'
// 	let count = 0;
// 	bCaneMesh.onclick = () => {
// 		cane.children[0].children[count].visible = false;
// 		count += 1;

// 	}

// 	const bMoveCam = document.createElement('button')
// 	bMoveCam.textContent = 'move cam'
// 	bMoveCam.onclick = () => {
// 		camera.position.set(0,0, 1.5);
// 		camera.lookAt(brush.position);
// 	}

//   const bParticles = document.createElement('button');
//   bParticles.textContent = 'Show Particles';
//   bParticles.onclick = (e) => {
// 		// if (points) { points.visible = !points.visible; setOpacity(points, 1); }
// 		if (e) {
// 			let {x, y, z} = brush.position
// 			brush.position.set(x, y, z + .01)
// 			camera.lookAt(chair);
// 		}
// 	}

// 	const bParticlesTransparent = document.createElement('button');
//   bParticlesTransparent.textContent = 'switch';
//   bParticlesTransparent.onclick = () => {
// 		console.log(state.index);
// 		state.index = Number(!state.index);
//   };

// 	const bAnimate = document.createElement('button')
// 	bAnimate.textContent = "Animation";
// 	bAnimate.onclick = () => {
// 		startTweenTransition();
// 	}

// 	const bFadeC = document.createElement('button')
// 	bFadeC.textContent = "Fade Chair";
// 	bFadeC.onclick = () => {
// 		const t = fadeTween(chair, true)
// 		t.start();
// 	}

// 	const bFixState = document.createElement('button')
// 	bFixState.textContent = 'Update State';
// 	bFixState.onclick = () => {
// 		manageState('fade', brush)
// 	}

//   panel.appendChild(bChair);
//   panel.appendChild(bBrush);
//   panel.appendChild(bCane);
// 	panel.appendChild(bCaneMesh);
// 	panel.appendChild(bMoveCam);
//   panel.appendChild(bParticles);
// 	panel.appendChild(bParticlesTransparent)
// 	panel.appendChild(bAnimate);
// 	panel.appendChild(bFadeC);
//   document.body.appendChild(panel);
// }

// // Generates path around model.
// function makeCylPath({
//   radius = 1.5,
//   samples = 900,       // number of frames/points
//   turns = 1,           // how many full wraps around the cylinder
//   amp = 0.7,           // rise/fall amplitude
//   waves = 2,           // how many up/down cycles per full loop
//   yOffset = 0
// } = {}) {
//   const pts = new Array(samples);
//   for (let i = 0; i < samples; i++) {
//     const t = (i / samples) * (Math.PI * 2); // 0..2π (exclusive)
//     const theta = turns * t;
//     const x = radius * Math.cos(theta);
//     const z = radius * Math.sin(theta);
//     const y = yOffset + amp * Math.sin(waves * t); // smooth rise/fall
//     pts[i] = { x, y, z };
//   }
// 	console.log(pts);
//   return pts;
// }