import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import Stats from 'three/addons/libs/stats.module.js';
import Tween, { Easing } from '@tweenjs/tween.js';


// global vars for threejs/scene
let scene, camera, renderer, stats, chair, brush, points, AnimationData;

let state = {
	prevAnimation: null,
	currentAnimation: 'chair',
	frameCount: 0,
	transitionStarted: false,
	reverse: false,
	arrays: {
		white: {
			og: [],
			target: []
		},
		black: {
			og: [],
			target: []
		},
	},
	colors: {
		orange: {
			r: 145/255,
			g: 50/255,
			b: 20/255
		},
    white: {
			r: 1,
			g: 1,
			b: 1
		}
	}
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
			loader.loadAsync('./Models/stool.glb'),
			loader.loadAsync('./Models/brush_2.glb')
		]);
		AnimationData = json;
		chair = chairGLB.scene;
		brush = brushGLB.scene;

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
		brush.position.set(-0.034, -1, -1.997);
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
	points.position.set(-0.046, -1, -1.995); // match end frame of chair animation
	points.visible = false; // start on currentAnimation = 'chair'

	// set state and save points coords for white and black target and original positions 
	const [ whitePts, blackPts ] = points.children;
	state.arrays = {
		white: {
			og: new Float32Array(whitePts.geometry.attributes.position.array),
			target: whitePts.geometry.attributes.targetPosition.array
		},
		black: {
			og: new Float32Array(blackPts.geometry.attributes.position.array),
			target: blackPts.geometry.attributes.targetPosition.array
		}
	};

	scene.add(points);
}


// --- load everything in order --- \\
init();
async function init() {
	setup();
	await loadAssets();
	createParticles();
	animate();
}


// --- --- \\
function animate(time) {
  requestAnimationFrame(animate);
  stats.update();
  Tween.update(time);

  switch (state.currentAnimation) {
    case 'chair':
      modelAnimation(chair, false);
      break;
		case 'chairFade': 
			modelFadeSwitch(chair, state.reverse);
			break;
    case 'transition':
			if (!state.transitionStarted) {
				state.transitionStarted = true;
				startTweenTransition();
			}
      break;
    case 'brush':
      modelAnimation(brush, true);
      break;
		case 'brushFade': 
			modelFadeSwitch(brush, state.reverse);
			break;
		case 'state':
			manageState()
  }

  renderer.render(scene, camera);
}

function modelFadeSwitch(model, reverse) {
	if(!fadeStep(model, reverse)) {
		points.position.copy(model.position);
		state.frameCount ++;
	} else if(reverse) {
		points.visible = false;
		state.currentAnimation = state.prevAnimation === 'chair' ? 'brush' : 'chair';
		state.prevAnimation = 'transition';
		state.frameCount = 0; // TODO: change??
	} else {
		model.visible = false;
		state.transitionStarted = false;
		state.currentAnimation = 'transition';
		state.frameCount = 0; // TODO: change??
	}
}

function modelAnimation(model, reverse) {
	const path = AnimationData.stool;
	let { frameCount } = state;
	if (frameCount < path.length - 1) {
		//determine pos/frame for model
		const frame = reverse ? (path.length - 1 - frameCount) : frameCount;

		//update camera + model position
		const { x, y, z } = path[frame];
		model.position.set(x, y, z);
		camera.lookAt(model.position)
		state.frameCount++;


	} else {
		state.frameCount = 0;
		state.prevAnimation = state.currentAnimation;
		const nextStep = state.currentAnimation === 'chair' ? 'chairFade' : 'brushFade';
		state.currentAnimation = nextStep;
		state.reverse = false;
		points.visible = true;
	}
}

// Fade model ↔ points in or out by Δ each call.
function fadeStep(model, reverse, delta = 0.01) {
  // Determine targets
  const modelTarget  = reverse ? 1 : 0;
  const pointsTarget = reverse ? 0 : 1;

  // We'll flip to false if *any* opacity isn't at target yet.
  let allDone = true;

  // 1) Fade the model’s meshes
  model.traverse(node => {
    if (!node.isMesh) return;
    // move it toward the target
    node.material.opacity = THREE.MathUtils.clamp(
      node.material.opacity + (reverse ? +delta : -delta),
      0, 1
    );
    // if it’s not quite at the target, we’re not done
    if (node.material.opacity !== modelTarget) allDone = false;
  });

  // 2) Fade the point clouds
  points.children.forEach(pt => {
    pt.material.opacity = THREE.MathUtils.clamp(
      pt.material.opacity + (reverse ? -delta : +delta),
      0, 1
    );
    if (pt.material.opacity !== pointsTarget) allDone = false;
  });

  return allDone;
}

function startTweenTransition() {
	const [whitePts, blackPts] = points.children;
	let color, model, whiteTarget, blackTarget, nextStep;

	// prob better way to do this but didn't want a ton of = bool ? ___ : ___;
	switch (state.prevAnimation) {
		case 'chair':
			nextStep     = 'brushFade';
			model        = brush;
			color        = state.colors.orange;
			whiteTarget  = state.arrays.white.target;
			blackTarget  = state.arrays.black.target;
			break;

		case 'brush':
			nextStep     = 'chairFade';
			model        = chair;
			color        = state.colors.white;
			whiteTarget  = state.arrays.white.og;
			blackTarget  = state.arrays.black.og;
			break;
	}
	const { r: R, g: G, b: B } = color;

	new Tween.Tween({ t:0 })
		.to({ t: .05 }, 3000)
		.easing(Easing.Exponential.Out)
		.onUpdate(o => {
		function calcStep(points, target, bool) {
			let posArr = points.geometry.attributes.position.array;
			let startColor = points.material.color;

			if(posArr[0] === target[0]) {console.log("FUCK")}

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
		state.frameCount++;

		// animation has ended, move to next step
		if(state.frameCount === 150) {
			state.frameCount = 0;
			model.visible = true;
			state.currentAnimation = nextStep;
			state.reverse = true;
		} 
	})
	.start();
}


// /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
// --disable-web-security \
// --user-data-dir="/tmp/chrome-dev-disable-cors" \
// --allow-file-access-from-files \                                                --enable-precise-memoryinfo \
// file:///Users/samuel/code/Elijah/Pi-code/Animation/camera.html