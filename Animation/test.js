import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import Stats from 'three/addons/libs/stats.module.js';
import Tween, {Easing} from 'https://unpkg.com/@tweenjs/tween.js@23.1.3/dist/tween.esm.js'


// TODO: 
// 1). Fix blink problem
// 2). Make logic seamlessly flow together
// 3). Change so camera flows around model
// 4). Build it back together in pi-viewer.js

// global vars for threejs/scene
let scene, camera, renderer, stats, chair, brush, points, AnimationData;

// let state = {
// 	chair: 0 || 1, // 0 or 1, lets you do state.arrays.white/black[state.chair] && state.colors[state.chair]
// 	prevAnimation: 'chair',
// 	currentAnimation: 'chair',
// 	frameCount: 0,
// 	transitionStarted: false,
// 	reverse: false,
// 	arrays: {
// 		white: {
// 			chair: [],
// 			brush: []
// 		},
// 		black: {
// 			chair: [],
// 			brush: []
// 		},
// 	},
// 	colors: {
// 		orange: {
// 			r: 145/255,
// 			g: 50/255,
// 			b: 20/255
// 		},
//     white: {
// 			r: 1,
// 			g: 1,
// 			b: 1
// 		}
// 	}
// }
let state = {
	index: 0 || 1, // 0 or 1, lets you do state.arrays.white/black[state.chair] && state.colors[state.chair]
	prevAnimation: 'chair',
	currentAnimation: 'chair',
	frameCount: 0,
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

console.log(state.chair);


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

// LOGIC: fade(from bursh trainsition to chair) state.index = 0, model opacity = o.t, aka 0 to 1
// animation (of chair) state.index = 1, model opacity = 1 - o.t
// For brush, state.index = 0 means use 1 - o.t && state.index = 1 means o.t

// function startFadeTween(model) {
// 		// this code only runs once when in a function
// 		// let indicator = (!!state.index) ? 1 : 0; 
// 		if (!!state.index && model.name === 'chair') {
// 			indicator = 0;
// 		} else if (model.name === 'chair') {
// 			indicator = 1;
// 		} else if (!!state.index && model.name === 'brush') {
// 			indicator = 1;
// 		} else {
// 			indicator = 0;
// 		}


// 		const fadeTween = new Tween.Tween({ t: 0 })
// 		.to({ t: 1 }, 1000)
// 		.easing(Easing.Exponential.Out)
// 		.onUpdate(o => {
// 			// takes o.t which runs from [0,1]. We will use this to set opacity on model and point cloud
// 			// 1) Fade the model’s meshes towards target (0 or 1)
			// model.traverse(node => {
			// 	if (!node.isMesh) return;
			// 	node.material.opacity = Math.abs(1 - indicator - o.t);
			// });

			// // 2) Fade the point clouds towards target (inverse of model)
			// points.children.forEach(pt => {
			// 	pt.material.opacity = 1 - node.material.opacity;
			// });
// 		}).start();
// }
function startFadeTween(model) {
  if (!model) return;

  // XOR: chair => !state.index, brush => !!state.index
  const s = !!state.index;
  const target = (model.name === 'chair') ? Number(!s) : Number(s); // 0 or 1

  // collect mesh materials once (handles single or array materials)
	let count = 0

	// THIS FIXES THE BLINK PROBLEM
	// model.traverse(node => { 
	// 	if (!node.isMesh) return;
	// 	node.material.transparent = true 
	// });
  // collect once
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
		if (chair) { chair.visible = !chair.visible; setOpacity(chair, 1)}
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
  bParticlesTransparent.textContent = 'Particle Transparent';
  bParticlesTransparent.onclick = () => {
		if (points) { 
			points.children.map(m => {
				m.opacity = 1;
				m.transparent = !m.transparent
			});
			// points.material.transparent = !points.material.transparent;
			// points.visible = !points.visible;
		}
  };

	const bAnimate = document.createElement('button')
	bAnimate.textContent = "Animation";
	bAnimate.onclick = () => {
		startTweenTransition();
		state.prevAnimation = 'chair' ? 'brush' : 'chair';
	}

	const bFade = document.createElement('button')
	bFade.textContent = "Fade";
	bFade.onclick = () => {
		for (let i = 0; i < 110; i++) {
			// modelFadeSwitch(brush, state.reverse);
			// state.index = !!state.index ? 0 : 1; // flip it
			// fadeTween.start();
			startFadeTween(chair);
		}
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
	panel.appendChild(bFade);
  document.body.appendChild(panel);
}

// const fadeTween = new Tween({t: 0})
// 	.to({ t: .05 }, 3000)
// 	.easing(Easing.Exponential.Out)
// 	.onUpdate(o => {
// 		// takes o.t which runs from [0,1]. We will use this to set opacity on model and point cloud
// 		// 1) Fade the model’s meshes towards target (0 or 1)
// 		model.traverse(node => {
// 			if (!node.isMesh) return;
// 			// (!!state.index) returns true for 1, false for 0
// 			node.material.opacity = (!!state.index) ? 1 - o.t : o.t;
// 			// node.material.opacity = THREE.MathUtils.clamp(
// 			// 	node.material.opacity + (reverse ? +delta : -delta),
// 			// 	0, 1
// 			// );
// 		});

// 		// 2) Fade the point clouds towards target (inverse of model)
// 		points.children.forEach(pt => {
// 			pt.material.opacity = (!!state.index) ? o.t : 1 - o.t;
// 			// pt.material.opacity = THREE.MathUtils.clamp(
// 			// 	pt.material.opacity + (reverse ? -delta : +delta),
// 			// 	0, 1
// 			// );
// 			// if (pt.material.opacity !== pointsTarget) allDone = false;
// 		});
// 		console.log(o)
// 	})

// TODO: Order will look something like this? 
// runAnimation('chair', chair)
// manageState('animation', chair)
// modelFadeSwitch(chair, state.reverse)
// manageState('fade', chair)
// startTweenTransition()
// manageState('transition', brush)
// modelFadeSwitch(brush, state.reverse)
// runAnimation('brush', brush)
// manageState('animation', chair)
// modelFadeSwitch(brush, state.reverse)
// manageState('fade', chair)
// ..... too much 

// TODO: Get rid of 
// ORDER: transition => fade => cameraPath => fade => transition => ...
// lots of state that has to change between functions, prob bc i am bad at coding 
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

// potentially silly, but lets 
function startTweenTransition(model) {
	console.log('ran');
	const [whitePts, blackPts] = points.children;
	const whiteTarget = state.arrays.white[state.index];
	const blackTarget = state.arrays.black[state.index];
	// let color, model, whiteTarget, blackTarget, nextStep;

	// prob better way to do this but didn't want a ton of = bool ? ___ : ___;
	// switch (state.prevAnimation) {
	// 	case 'chair':
	// 		nextStep     = 'brushFade';
	// 		model        = brush;
	// 		color        = state.colors.orange;
	// 		whiteTarget  = state.arrays.white.brush;
	// 		blackTarget  = state.arrays.black.brush;
	// 		break;

	// 	case 'brush':
	// 		nextStep     = 'chairFade';
	// 		model        = chair;
	// 		color        = state.colors.white;
	// 		whiteTarget  = state.arrays.white.chair;
	// 		blackTarget  = state.arrays.black.chair;
	// 		break;
	// }
	const { r: R, g: G, b: B } = state.colors[state.index];

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
		// if(state.frameCount === 150) {
		// 	state.frameCount = 0;
		// 	model.visible = true;
		// 	state.currentAnimation = nextStep;
		// 	state.reverse = true;
		// } 
	})
	.start();
}

function modelFadeSwitch(model, reverse) {
	if(!fadeStep(model, reverse)) {
		points.position.copy(model.position);
		state.frameCount ++;
	} else if(reverse) { // 
		points.visible = false;
		state.currentAnimation = state.prevAnimation === 'chair' ? 'brush' : 'chair';
		state.prevAnimation = 'transition';
		state.frameCount = 0; // TODO: change??
	} else {
		model.visible = false;
		state.transitionStarted = false;
		state.currentAnimation = 'transition';
		state.frameCount = 0; // TODO: change??
		debugger;
	}
}

// Fade model ↔ points in or out by Δ each call.
function fadeStep(model, delta = 0.01) {
	console.log('ra')
	// Determine targets
	const modelTarget  = state.chair ? 0 : 1;
	const pointsTarget = state.chair ? 1 : 0;

	// We'll flip to false if any opacity isn't at target yet.
	let allDone = true;

	// 1) Fade the model’s meshes
	model.traverse(node => {
		if (!node.isMesh) return;
		console.log('a')
		// move it toward the target
		node.material.opacity = THREE.MathUtils.clamp(
			node.material.opacity + (state.index === 0 ? +delta : -delta),
			0, 1
		);
		// if it’s not quite at the target, we’re not done
		if (node.material.opacity !== modelTarget) allDone = false;
	});

	// 2) Fade the point clouds
	points.children.forEach(pt => {
		console.log('b');
		pt.material.opacity = THREE.MathUtils.clamp(
			pt.material.opacity + (state.index === 0 ? -delta : +delta),
			0, 1
		);
		if (pt.material.opacity !== pointsTarget) allDone = false;
	});

	return allDone;
}


// // --- --- \\
// function animate(time) {
//   requestAnimationFrame(animate);
//   stats.update();
//   Tween.update(time);

//   switch (state.currentAnimation) {
//     case 'chair':
//       modelAnimation(chair, false);
//       break;
// 		case 'chairFade': 
// 			modelFadeSwitch(chair, state.reverse);
// 			break;
//     case 'transition':
// 			if (!state.transitionStarted) {
// 				state.transitionStarted = true;
// 				startTweenTransition();
// 			}
//       break;
//     case 'brush':
//       modelAnimation(brush, true);
//       break;
// 		case 'brushFade': 
// 			modelFadeSwitch(brush, state.reverse);
// 			break;
// 		case 'state':
// 			manageState()
//   }

//   renderer.render(scene, camera);
// }

// function modelFadeSwitch(model, reverse) {
// 	if(!fadeStep(model, reverse)) {
// 		points.position.copy(model.position);
// 		state.frameCount ++;
// 	} else if(reverse) {
// 		points.visible = false;
// 		state.currentAnimation = state.prevAnimation === 'chair' ? 'brush' : 'chair';
// 		state.prevAnimation = 'transition';
// 		state.frameCount = 0; // TODO: change??
// 	} else {
// 		model.visible = false;
// 		state.transitionStarted = false;
// 		state.currentAnimation = 'transition';
// 		state.frameCount = 0; // TODO: change??
// 	}
// }

// function modelAnimation(model, reverse) {
// 	const path = AnimationData.stool;
// 	let { frameCount } = state;
// 	if (frameCount < path.length - 1) {
// 		//determine pos/frame for model
// 		const frame = reverse ? (path.length - 1 - frameCount) : frameCount;

// 		//update camera + model position
// 		const { x, y, z } = path[frame];
// 		model.position.set(x, y, z);
// 		camera.lookAt(model.position)
// 		state.frameCount++;


// 	} else {
// 		state.frameCount = 0;
// 		state.prevAnimation = state.currentAnimation;
// 		const nextStep = state.currentAnimation === 'chair' ? 'chairFade' : 'brushFade';
// 		state.currentAnimation = nextStep;
// 		state.reverse = false;
// 		points.visible = true;
// 	}
// }

// // Fade model ↔ points in or out by Δ each call.
// function fadeStep(model, reverse, delta = 0.01) {
//   // Determine targets
//   const modelTarget  = reverse ? 1 : 0;
//   const pointsTarget = reverse ? 0 : 1;

//   // We'll flip to false if *any* opacity isn't at target yet.
//   let allDone = true;

//   // 1) Fade the model’s meshes
//   model.traverse(node => {
//     if (!node.isMesh) return;
//     // move it toward the target
//     node.material.opacity = THREE.MathUtils.clamp(
//       node.material.opacity + (reverse ? +delta : -delta),
//       0, 1
//     );
//     // if it’s not quite at the target, we’re not done
//     if (node.material.opacity !== modelTarget) allDone = false;
//   });

//   // 2) Fade the point clouds
//   points.children.forEach(pt => {
//     pt.material.opacity = THREE.MathUtils.clamp(
//       pt.material.opacity + (reverse ? -delta : +delta),
//       0, 1
//     );
//     if (pt.material.opacity !== pointsTarget) allDone = false;
//   });

//   return allDone;
// }

// function startTweenTransition() {
// 	const [whitePts, blackPts] = points.children;
// 	let color, model, whiteTarget, blackTarget, nextStep;

// 	// prob better way to do this but didn't want a ton of = bool ? ___ : ___;
// 	switch (state.prevAnimation) {
// 		case 'chair':
// 			nextStep     = 'brushFade';
// 			model        = brush;
// 			color        = state.colors.orange;
// 			whiteTarget  = state.arrays.white.target;
// 			blackTarget  = state.arrays.black.target;
// 			break;

// 		case 'brush':
// 			nextStep     = 'chairFade';
// 			model        = chair;
// 			color        = state.colors.white;
// 			whiteTarget  = state.arrays.white.og;
// 			blackTarget  = state.arrays.black.og;
// 			break;
// 	}
// 	const { r: R, g: G, b: B } = color;

// 	new Tween.Tween({ t:0 })
// 		.to({ t: .05 }, 3000)
// 		.easing(Easing.Exponential.Out)
// 		.onUpdate(o => {
// 		function calcStep(points, target, bool) {
// 			let posArr = points.geometry.attributes.position.array;
// 			let startColor = points.material.color;

// 			if(posArr[0] === target[0]) {console.log("FUCK")}

// 			for (let i = 0; i < posArr.length; i++) {
// 				const endPos = THREE.MathUtils.lerp(posArr[i], target[i], o.t);
// 				posArr[i] = endPos;
// 			}

// 			if(bool) {
// 				const r = THREE.MathUtils.lerp(startColor.r, R, o.t);
// 				const g = THREE.MathUtils.lerp(startColor.g, G, o.t);
// 				const b = THREE.MathUtils.lerp(startColor.b, B, o.t);
// 				startColor.setRGB(r, g, b);
// 			}

// 			points.geometry.attributes.position.needsUpdate = true;
// 		}
		
// 		calcStep(whitePts, whiteTarget, true);
// 		calcStep(blackPts, blackTarget, false);
// 		state.frameCount++;

// 		// animation has ended, move to next step
// 		if(state.frameCount === 150) {
// 			state.frameCount = 0;
// 			model.visible = true;
// 			state.currentAnimation = nextStep;
// 			state.reverse = true;
// 		} 
// 	})
// 	.start();
// }


// /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
// --disable-web-security \
// --user-data-dir="/tmp/chrome-dev-disable-cors" \
// --allow-file-access-from-files \                                                --enable-precise-memoryinfo \
// file:///Users/samuel/code/Elijah/Pi-code/Animation/camera.html