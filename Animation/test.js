import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import Stats from 'three/addons/libs/stats.module.js';
import Tween, {Easing} from 'https://unpkg.com/@tweenjs/tween.js@23.1.3/dist/tween.esm.js'


// TODO: 
// 1). Fix blink problem (DONE)
// 2). Make logic seamlessly flow together
// 3). Change so camera flows around model
// 4). Build it back together in pi-viewer.js
// 5). Store point cloud start and target positions and delta so we can loop through them. 
// OPTIONAL: hookup resource profile and minimize it

// global vars for threejs/scene
const Phase = { FadeA:0, Transition:1, FadeB:2, Animate:3 };
let scene, camera, renderer, stats, brush, chair, points, AnimationData;
let state = {
	model: chair,
	modelVisible: true,
	index: 0 || 1, // 0 or 1, lets you do state.arrays.white/black[state.chair] && state.colors[state.chair]
	phase: Phase.FadeA,
	framesLeft: 60,
	arrays: { // holds target pos for points
		white: [],
		black: [],
	},
	colors: [
    { // white
			r: 1,
			g: 1,
			b: 1
		},
		{ // orange
			r: 145/255,
			g: 50/255,
			b: 20/255
		},
	]
}

// maybe getting lost in the performance sauce w/ this one
const fadeNodes = {
	model: [ [], [] ],
	points: []
}
function createFadeNodes() {
	chair.traverse(n => {
    if (n.isMesh && n.material) {
      if (Array.isArray(n.material)) fadeNodes.model[1].push(...n.material.filter(Boolean));
      else fadeNodes.model[1].push(n.material);
    }
  });

	brush.traverse(n => {
    if (n.isMesh && n.material) {
      if (Array.isArray(n.material)) fadeNodes.model[0].push(...n.material.filter(Boolean));
      else fadeNodes.model[0].push(n.material);
    }
  });

  fadeNodes.points = (points.children || [])
    .map(p => p.material)
    .filter(Boolean);
}

// simplifies point transition a ton - run it once in init
let wDelta, bDelta, whiteStart, blackStart;
function createDeltas() {
	const [whitePts, blackPts] = points.children;
	whiteStart  = new Float32Array(whitePts.geometry.attributes.position.array);
  blackStart  = new Float32Array(blackPts.geometry.attributes.position.array);
  const whiteTarget = new Float32Array(state.arrays.white[state.index]);
  const blackTarget = new Float32Array(state.arrays.black[state.index]);
	
	
	wDelta = new Float32Array(whiteTarget.length); // same dimension as target, but w/ 0's
	bDelta = new Float32Array(blackTarget.length);
  for (let i = 0; i < whiteTarget.length; i++) { wDelta[i] = whiteTarget[i] - whiteStart[i]; }
  for (let i = 0; i < blackTarget.length; i++) { bDelta[i] = blackTarget[i] - blackStart[i]; }
}

function setup() {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0xD2B48C); // tan

	stats = new Stats();
	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild(renderer.domElement);
	document.body.appendChild(stats.dom);

	camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 10);
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
};


// --- load & set json and glb's --- \\
async function loadAssets() {
	try{
		const loader = new GLTFLoader();
		const [json, chairGLB, brushGLB] = await Promise.all([
			fetch('./path-data.json').then(r=>r.json()),
			loader.loadAsync('../Models/stool.glb'),
			loader.loadAsync('../Models/brush_2.glb')
		]);
		AnimationData = json;
		chair = chairGLB.scene;
		brush = brushGLB.scene;

		chair.name = 'chair';
		brush.name = 'brush';

		// helps fix visual bug
		chair.traverse(n => {
			if (n.isMesh && n.material) {
				n.material.transparent = true;
				n.material.depthTest = true;
			}
		});
		brush.traverse(n => {
			if (n.isMesh && n.material) {
				n.material.transparent = true;
				n.material.depthTest = true;
			}
		});

		// resets all mesh data that comes in weird from glb models
		brush.updateMatrixWorld(true); 
		brush.traverse(node => {
			if (node.isMesh) {
				node.updateMatrix();
				node.geometry.applyMatrix4(node.matrix);
				node.matrix.identity();
				node.position.set(0, 0, 0);
				node.rotation.set(0, 0, 0);
				node.scale.set(1, 1, 1);
			}
		});

		brush.scale.set(1,1,1);
		brush.position.set(0,-.5,0);
		brush.rotation.x = THREE.MathUtils.degToRad(90);
		brush.visible = false;

		chair.rotation.x = THREE.MathUtils.degToRad(90);
		chair.position.set(0, -.5, -.12); // suck at blender, so have to manually set

		chair.traverse(node => {
			if(node.isMesh) {
				node.material.transparent = true;
			}
		})
		
		scene.add(chair, brush);
		console.log('scene', AnimationData.stool.length, scene);

	}catch (err) {
		console.error('Error loading glb model:', err);
	};
};

// --- create model particles for transition --- \\
function createParticles() {
	// config
	const counts = { white: 6000, black: 2000 };

	// initial setup of colors of points
	const materials = {
		white: new THREE.PointsMaterial({ size: .0125, sizeAttenuation: true, color: 0xE4E4E4 }),
		black: new THREE.PointsMaterial({ size: .0125, sizeAttenuation: true, color: 0x111111 })
	};

	// models both have two different sections. Grab them
	const chairWhiteMesh = chair.children[0].children[0];
	const chairBlackMesh = chair.children[0].children[1];
	const brushBodyMesh = brush.children[0];
	const brushTipMesh = brush.children[1];

	// setup for grabbing random points on mesh
	const sampler = {
		white: new MeshSurfaceSampler(chairWhiteMesh).build(),
		black: new MeshSurfaceSampler(chairBlackMesh).build(),
		brushBody: new MeshSurfaceSampler(brushBodyMesh).build(),
		brushTip: new MeshSurfaceSampler(brushTipMesh).build()
	};

	// sample N points from a surface sampler
	function samplePoints(surfSampler, N) {
		const array = new Float32Array(N * 3);
		const v = new THREE.Vector3();

		for (let i = 0; i < N; i++) {
			surfSampler.sample(v);
			array.set([v.x, v.y, v.z], i * 3);
		}
		return array;
	}

	// create a points cloud with position & targetPosition
	function makePointCloud(count, material, surfA, surfB) {
		const posA = samplePoints(surfA, count);
		const posB = samplePoints(surfB, count);

		const geometry = new THREE.BufferGeometry()
			.setAttribute('position', new THREE.BufferAttribute(posA, 3).setUsage(THREE.DynamicDrawUsage))
			.setAttribute('targetPosition', new THREE.BufferAttribute(posB, 3));

		geometry.computeBoundingSphere();

		const point = new THREE.Points(geometry, material);
		point.material.transparent = true;
		point.material.opacity = 0;

		return point;
	}

	const pointsW = makePointCloud(counts.white, materials.white, sampler.white, sampler.brushBody);
	const pointsB = makePointCloud(counts.black, materials.black, sampler.black, sampler.brushTip);

	// set transparency here (for later animations)
	chairWhiteMesh.material.transparent = true;
	chairBlackMesh.material.transparent = true;

	// group & position them together
	points = new THREE.Group();
	points.add(pointsW, pointsB);
	points.rotation.x = THREE.MathUtils.degToRad(90);

	 // match chair & set state for starting cycle
	points.position.set(0,-.5,-.12);
	points.visible = true;

	// set state and save points coords for white and black target and original positions 
	const [ whitePts, blackPts ] = points.children;
	state.arrays = {
		white: [
			new Float32Array(whitePts.geometry.attributes.position.array),
			new Float32Array(whitePts.geometry.attributes.targetPosition.array)
		],
		black: [
			new Float32Array(blackPts.geometry.attributes.position.array),
			new Float32Array(blackPts.geometry.attributes.targetPosition.array)
		]
	};

	// helps fix visual bug
	points.children.map(p => {
		p.material.transparent = true; 
		p.material.depthTest = true; 
		p.material.depthWrite = false;
	})

	scene.add(points);
}


// --- load everything in order --- \\
init();
async function init() {
	setup();
	await loadAssets();
	createParticles();
	addUI();
	createFadeNodes();
	createDeltas();
	state.model = chair;

	animate();
}

function tickPhase() {
  switch (state.phase) {
    case Phase.FadeA: {
			stepFade(state.framesLeft, 60);
      // stepFade(model, /*towardVisible=*/false);
      break;
    }
    case Phase.Transition: {
      stepTransition(state.framesLeft);                           // TODO: make this function
      break;
    }
    case Phase.FadeB: {
			stepFade(state.framesLeft, 60);
      // stepFade(model, /*towardVisible=*/true);
      break;
    }
    case Phase.Animate: {
      stepModelAnimation(state.framesLeft);                       // TODO: make this function
      break;
    }
  }
	state.framesLeft--;

  // decides when to move to next step
  if (state.framesLeft === 0) {
    switch (state.phase) {
      case Phase.FadeA: {
				state.modelVisible = false;
				state.framesLeft = 10; // 3 sec
				state.phase = Phase.Transition
				break;
			}
      case Phase.Transition: {
				state.framesLeft = 60; // 1 sec
				state.phase = Phase.FadeB;
				break;
			}
      case Phase.FadeB: {
				state.framesLeft = AnimationData.stool.length // TODO
				state.phase = Phase.Animate;
				break;
			}
      case Phase.Animate: {
				state.framesLeft = 60;
				state.phase = Phase.FadeA;
				state.model = !!state.index ? chair : brush;
				state.index = !!state.index ? 0 : 1;
				state.modelVisible = true;
				break;
			}
    }
  }
}

function animate(time) {
	requestAnimationFrame(animate);
	stats.update();
	Tween.update(time);
	tickPhase();


	renderer.render(scene, camera);
}

function addUI() {
  // minimal styles: bottom-right, out of the way
  const style = document.createElement('style');
  style.textContent = `
    .ui-panel{
      position:fixed; right:16px; bottom:16px; z-index:9999;
      display:grid; gap:8px; padding:10px; border-radius:10px;
      background:rgba(0,0,0,.55); color:#fff; font:500 13px/1 system-ui, sans-serif;
      user-select:none;
    }
    .ui-panel button{
      min-width:140px; padding:8px 10px; border-radius:8px; border:0; cursor:pointer;
      background:rgba(255,255,255,.1); color:#fff;
    }
    .ui-panel button:hover{ background:rgba(255,255,255,.18); }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'ui-panel';

  // buttons
  const bChair = document.createElement('button');
  bChair.textContent = 'Show Chair';
  bChair.onclick = () => {
		if (chair) { chair.visible = !chair.visible; }
  };

  const bBrush = document.createElement('button');
  bBrush.textContent = 'Show Brush';
  bBrush.onclick = () => {
		if (brush) { brush.visible = !brush.visible; }
  };

  const bParticles = document.createElement('button');
  bParticles.textContent = 'Show Particles';
  bParticles.onclick = (e) => {
		// if (points) { points.visible = !points.visible; setOpacity(points, 1); }
		if (e) {
			camera.position.set(1, 1, 1)
			camera.lookAt(chair);
		}
	}

	const bParticlesTransparent = document.createElement('button');
  bParticlesTransparent.textContent = 'switch';
  bParticlesTransparent.onclick = () => {
		console.log(state.index);
		state.index = Number(!state.index);
  };

	const bAnimate = document.createElement('button')
	bAnimate.textContent = "Animation";
	bAnimate.onclick = () => {
		startTweenTransition();
	}

	const bFadeC = document.createElement('button')
	bFadeC.textContent = "Fade Chair";
	bFadeC.onclick = () => {
		startFadeTween();
	}

	const bFixState = document.createElement('button')
	bFixState.textContent = 'Update State';
	bFixState.onclick = () => {
		manageState('fade', brush)
	}

  panel.appendChild(bChair);
  panel.appendChild(bBrush);
  panel.appendChild(bParticles);
	panel.appendChild(bParticlesTransparent)
	panel.appendChild(bAnimate);
	panel.appendChild(bFadeC);
  document.body.appendChild(panel);
}

function stepModelAnimation(framesLeft) {
	const currentFrame = AnimationData.stool.length - framesLeft;
	const currentPosition = AnimationData.stool[currentFrame];
	const {x,y,z} = currentPosition;
	camera.position.set(x, y, z);
	camera.lookAt(state.model.position); // may need to fix this;
}

function stepFade(framesLeft, framesTotal) {
	let u = framesLeft/framesTotal; 
	if(u === 1/60 || u === 59/60) { u = Math.round(u); } // hit 0 and 1
  const modelOpacity  = state.modelVisible ? u : 1 - u;

	fadeNodes.model[state.index].forEach(material => {
		material.opacity = modelOpacity;
		material.depthWrite = (modelOpacity >= .99)
	})

	fadeNodes.points.forEach(material => material.opacity = 1 - modelOpacity);
}

// TODO: 
function stepTransition(frames) {
	const t = 1 - (frames/180);
	const [whitePts, blackPts] = points.children;

	const startCol = whitePts.material.color.clone();
  const { r: R, g: G, b: B } = state.colors[state.index]; // always chooses opposite of whitePts

	// color = start + (target - start) * u
	if (t > 0) {
		whitePts.material.color.setRGB(
			startCol.r + (R - startCol.r) * t,
			startCol.g + (G - startCol.g) * t,
			startCol.b + (B - startCol.b) * t
		);
	}

	// unfortunately, since brush and chair's respective positions are different, 
	// we have to shift points dynamically as it walks through this animation (thankfully, only on z axis)
	const zStart = !!state.index ? -.12 : 0;
	const zDelta = !!state.index ? .12: -.12;
	const zPos = zStart + (zDelta * t);
	points.position.set(0,0,zPos);

	const wPos = whitePts.geometry.attributes.position.array;
  const bPos = blackPts.geometry.attributes.position.array;

	// update point positions = start + delta * u
  for (let i = 0; i < wDelta.length; i++) { wPos[i] = whiteStart[i] + (wDelta[i] * t); }
  for (let i = 0; i < bDelta.length; i++) { bPos[i] = blackStart[i] + (bDelta[i] * t); }
}


// LOGIC: Whole system runs on fade => transition => fade => animation => fade => ... and repeat 
// pattern. This function is the fade part. So it runs twice, and cycles between fading in and out 
// points, as well as brush and chair models. Specifically, it cycles as follows:
// (fade(chair, !points) => !chair, points) => transition => (fade(!brush, points) => brush, 
// !points) => animation => (fade(brush, !points) => !brush, points) => transition => (fade(!chair, 
// points) => chair, !points) => and repeat pattern
function startFadeTween() {
	if (!chair || !brush || !points) return;

  // Decide which model to drive this fade cycle.
  // If chair is visible or we're at the "chair comes next" branch (state.index false and brush hidden) => chair, else we're on brush.
  const s = !!state.index; // 0 => false, 1 => true
  const model = (chair.visible || (!s && !brush.visible)) ? chair : brush;

  // Target opacity for the chosen model this cycle: chair => !s, brush => s
  const target = (model === chair) ? Number(!s) : Number(s); // 0 or 1

  // make sure both are visible during fading
  model.visible = true;
  points.visible = true;

  // grab once, outside .onUpdate()
  const meshMats = [];
  model.traverse(n => {
    if (n.isMesh && n.material) {
      if (Array.isArray(n.material)) meshMats.push(...n.material.filter(Boolean));
      else meshMats.push(n.material);
    }
  });

  const pointMats = (points.children || [])
    .map(p => p.material)
    .filter(Boolean);

  new Tween.Tween({ t: 0 })
    .to({ t: 1 }, 1000)
    .easing(Easing.Quartic.Out)
    .onUpdate(({ t }) => {
			const modelOpacity  = (target === 1) ? t : (1 - t);

      meshMats.forEach(m => {
        m.opacity    = modelOpacity;
        m.depthWrite = (modelOpacity >= .99);
      });

      pointMats.forEach(pm => {
        pm.opacity = 1 - modelOpacity;
      });
		})
		.onComplete(() => {
			// make sure everything end in right state
			points.visible = points.children[0].material.opacity > .99;
			model.visible = !points.visible;
		})
		.start();
}

// GPT's way of more dramatic transition animation
const BackIn  = (s = 1.70158) => k => k * k * ((s + 1) * k - s);
function startTweenTransition() {
  const [whitePts, blackPts] = points.children;

  // no mutating
  const whiteStart  = new Float32Array(whitePts.geometry.attributes.position.array);
  const blackStart  = new Float32Array(blackPts.geometry.attributes.position.array);
  const whiteTarget = new Float32Array(state.arrays.white[state.index]);
  const blackTarget = new Float32Array(state.arrays.black[state.index]);

	// create an array which holds each points respective delta x,y,z (where delta is targetPosition - startPosition).
	// allows for less computation & you always end at target position
	const wDelta = new Float32Array(whiteTarget.length); // same dimension as target, but w/ 0's
	const bDelta = new Float32Array(blackTarget.length);
  for (let i = 0; i < whiteTarget.length; i++) { wDelta[i] = whiteTarget[i] - whiteStart[i]; }
  for (let i = 0; i < blackTarget.length; i++) { bDelta[i] = blackTarget[i] - blackStart[i]; }

  const startCol = whitePts.material.color.clone();
  const { r: R, g: G, b: B } = state.colors[state.index]; // always chooses opposite of whitePts

	// unfortunately, since brush and chair's respective positions are different, 
	// we have to shift points dynamically as it walks through this animation (thankfully, only on z axis)
	const zStart = !!state.index ? -.12 : 0;
	const zDelta = !!state.index ? .12: -.12;

  new Tween.Tween({ t: 0 })
    .to({ t: 1 }, 3000)
    .easing(BackIn(4))
    .onUpdate(({ t }) => {
      const wPos = whitePts.geometry.attributes.position.array;
      const bPos = blackPts.geometry.attributes.position.array;

			// positions = start + delta * u
      for (let i = 0; i < wDelta.length; i++) { wPos[i] = whiteStart[i] + (wDelta[i] * t); }
      for (let i = 0; i < bDelta.length; i++) { bPos[i] = blackStart[i] + (bDelta[i] * t); }

      whitePts.geometry.attributes.position.needsUpdate = true;
      blackPts.geometry.attributes.position.needsUpdate = true;

      // color = start + (target - start) * u
      if (t > 0) {
        whitePts.material.color.setRGB(
          startCol.r + (R - startCol.r) * t,
          startCol.g + (G - startCol.g) * t,
          startCol.b + (B - startCol.b) * t
        );
      }

			// move point cloud
			const zPos = zStart + (zDelta * t);
			points.position.set(0,0,zPos);

    })
    .onComplete(() => {
      // snap to exact targets to kill float noise (write into existing buffers)
      whitePts.geometry.attributes.position.array.set(whiteTarget);
      blackPts.geometry.attributes.position.array.set(blackTarget);
      whitePts.geometry.attributes.position.needsUpdate = true;
      blackPts.geometry.attributes.position.needsUpdate = true;

      whitePts.material.color.setRGB(R, G, B);
    })
    .start();
}


// /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
// --disable-web-security \
// --user-data-dir="/tmp/chrome-dev-disable-cors" \
// --allow-file-access-from-files \                                                --enable-precise-memoryinfo \
// file:///Users/samuel/code/Elijah/Pi-code/Animation/camera.html