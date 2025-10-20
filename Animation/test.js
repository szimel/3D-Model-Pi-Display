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
// OPTIONAL: hookup resource profile and minimize it

// global vars for threejs/scene
let scene, camera, renderer, stats, chair, brush, points, AnimationData;
let state = {
	index: 0 || 1, // 0 or 1, lets you do state.arrays.white/black[state.chair] && state.colors[state.chair]
	transitionStarted: false,
	reverse: false,
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

		// resets all mesh data that comes in weird from glb models
		brush.updateMatrixWorld(true); // flatten the world matrices
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
		// brush.position.set(-0.034, -1, -1.997);
		brush.position.set(0,0,0);
		brush.rotation.x = THREE.MathUtils.degToRad(90);
		brush.visible = false;

		chair.rotation.x = THREE.MathUtils.degToRad(90);

		chair.traverse(node => {
			if(node.isMesh) {
				node.material.transparent = true;
			}
		})

		brush.traverse(node => {
			if(node.isMesh) {
				node.material.opacity = 0  // only do brush as we start with state.currentAnimation = 'chair'
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
	// points.position.set(-0.046, -1, -1.995); // match end frame of chair animation
	points.position.set(0,0,0);
	points.visible = false; // start on currentAnimation = 'chair'

	// set state and save points coords for white and black target and original positions 
	const [ whitePts, blackPts ] = points.children;
	state.arrays = {
		white: [
			new Float32Array(whitePts.geometry.attributes.position.array),
			whitePts.geometry.attributes.targetPosition.array
		],
		black: [
			new Float32Array(blackPts.geometry.attributes.position.array),
			blackPts.geometry.attributes.targetPosition.array
		]
	};

	scene.add(points);
}


// --- load everything in order --- \\
init();
async function init() {
	setup();
	await loadAssets();
	createParticles();
	addUI();
	animate();
}

function animate(time) {
	requestAnimationFrame(animate);
	stats.update();
	camera.lookAt(0,0,0);
	Tween.update(time);

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

  // tiny helper to set opacity when we show/hide
  const setOpacity = (obj, val) => {
    if (!obj) return;
    obj.traverse(n => {
      if (n.material) {
        if (Array.isArray(n.material)) {
          n.material.forEach(m => { if (m && typeof m.opacity === 'number') { m.transparent = true; m.opacity = val; console.log('asdf'); } });
        } else if (typeof n.material.opacity === 'number') {
					console.log('hit');
          n.material.transparent = true;
          n.material.opacity = val;
        }
      }
    });
  };

  // buttons
  const bChair = document.createElement('button');
  bChair.textContent = 'Show Chair';
  bChair.onclick = () => {
		if (chair) { chair.visible = !chair.visible; }
  };

  const bBrush = document.createElement('button');
  bBrush.textContent = 'Show Brush';
  bBrush.onclick = () => {
		if (brush) { brush.visible = !brush.visible; setOpacity(brush, 1); }
  };

  const bParticles = document.createElement('button');
  bParticles.textContent = 'Show Particles';
  bParticles.onclick = () => {
		if (points) { points.visible = !points.visible; setOpacity(points, 1); }
  };

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


// LOGIC: fade(from brush transition to chair) state.index = 0, model opacity = o.t, aka 0 to 1
// animation (of chair) state.index = 1, model opacity = 1 - o.t
// For brush, state.index = 0 means use 1 - o.t && state.index = 1 means o.t
function startFadeTween() {
	// Need to decide which model we are in, within the animation cycle
	let model;
	if (chair.visible) model = chair;
	else if(!chair.visible && !state.index && !brush.visible) model = chair;
	else model = brush;



  // chair => !state.index, brush => !!state.index
  const s = !!state.index;
  const target = (model.name === 'chair') ? Number(!s) : Number(s); // 0 or 1

  // collect once, outside of tween.onUpdate()
  const meshMats = [];
  model.traverse(n => {
    if (n.isMesh && n.material) {
      if (Array.isArray(n.material)) meshMats.push(...n.material.filter(Boolean));
      else meshMats.push(n.material);
    }
  });

  const pointMats = (points?.children || [])
    .map(p => p.material)
    .filter(Boolean);

  new Tween.Tween({ t: 0 })
    .to({ t: 1 }, 1000)
    .easing(Easing.Exponential.Out)
    .onUpdate(({ t }) => {
			const modelOpacity = (target === 1) ? t : (1 - t);

			meshMats.forEach(m => {
        m.transparent = true;
        m.depthTest = true;
        m.depthWrite = (modelOpacity >= 0.999); // <-- disable while semi/fully transparent
        m.opacity = modelOpacity;
      });

			// points fade inverse, never write depth
      pointMats.forEach(pm => {
        pm.transparent = true;
        pm.depthTest = true;
        pm.depthWrite = false;            // <-- prevent “dimming” interactions
        pm.opacity = 1 - modelOpacity;
      });

      // hide fully invisible model to avoid future depth artifacts
			model.visible = !(modelOpacity <= .001);

      // // fade model to `target` and points to the inverse
      // const modelOpacity = target ? t : (1 - t);
			// model.traverse(node => {
			// 	if (!node.isMesh) return;
			// 	node.material.opacity = modelOpacity;
			// });

			// // 2) Fade the point clouds towards target (inverse of model)
			// points.children.forEach(pt => {
			// 	pt.material.opacity = 1 - modelOpacity;
			// });
			// meshMats.forEach(m => m.opacity = modelOpacity);
			// pointMats.forEach(pm => pm.opacity = 1 - modelOpacity);
		})
		.start();
}


// ORDER is roughly fade => transition => fade => camera path => ...repeat
function manageState(prev,model) {
	// after fadeAnimation
	if (prev === 'fade') {

	}
	if(prev === 'transition') {
			state.frameCount = 0;
			model.visible = true;
			state.currentAnimation = model = brush ? 'chairFade' : 'brushFade';
			state.reverse = true;
			state.prevAnimation = 'transition'
	}
}

// no context needed
function startTweenTransition() {
	const [whitePts, blackPts] = points.children;
	const whiteTarget = state.arrays.white[state.index];
	const blackTarget = state.arrays.black[state.index];
	const { r: R, g: G, b: B } = state.colors[state.index];

	new Tween.Tween({ t:0 })
		.to({ t: .05 }, 3000)
		.easing(Easing.Exponential.Out)
		.onUpdate(o => {
		function calcStep(points, target, bool) {
			let posArr = points.geometry.attributes.position.array;
			let startColor = points.material.color;

			if(posArr[0] === target[0]) {console.log("you done messed up")}

			for (let i = 0; i < posArr.length; i++) {
				const endPos = THREE.MathUtils.lerp(posArr[i], target[i], o.t);
				posArr[i] = endPos;
			}

			if(bool) {
				const r = THREE.MathUtils.lerp(startColor.r, R, o.t);
				const g = THREE.MathUtils.lerp(startColor.g, G, o.t);
				const b = THREE.MathUtils.lerp(startColor.b, B, o.t);
				startColor.setRGB(r, g, b);
			}

			points.geometry.attributes.position.needsUpdate = true;
		}
		
		calcStep(whitePts, whiteTarget, true);
		calcStep(blackPts, blackTarget, false);
	})
	.start();
}


// /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
// --disable-web-security \
// --user-data-dir="/tmp/chrome-dev-disable-cors" \
// --allow-file-access-from-files \                                                --enable-precise-memoryinfo \
// file:///Users/samuel/code/Elijah/Pi-code/Animation/camera.html