import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import Stats from 'three/addons/libs/stats.module.js';
import Tween, { Easing } from 'https://unpkg.com/@tweenjs/tween.js@23.1.3/dist/tween.esm.js';


// global vars for threejs/scene
let scene, camera, renderer, stats, brush, chair, cane, points, AnimationData;

let state = {
	model: null,
	// 1 = chair, 0 = brush
	index: 1,
	colors: [
		{ r: 1, g: 1, b: 1 }, // white
		{ r: 145 / 255, g: 50 / 255, b: 20 / 255 }, // orange
	],
};

// Pre-collected materials for fast fade
const fadeNodes = {
	model: [[], []], // [brushMats, chairMats]
	points: [],
};

function createFadeNodes() {
	fadeNodes.model = [[], []];
	fadeNodes.points = [];

	chair.traverse((n) => {
		if (n.isMesh && n.material) {
			if (Array.isArray(n.material)) fadeNodes.model[1].push(...n.material.filter(Boolean));
			else fadeNodes.model[1].push(n.material);
		}
	});

	brush.traverse((n) => {
		if (n.isMesh && n.material) {
			if (Array.isArray(n.material)) fadeNodes.model[0].push(...n.material.filter(Boolean));
			else fadeNodes.model[0].push(n.material);
		}
	});

	fadeNodes.points = (points.children || [])
		.map((p) => p.material)
		.filter(Boolean);
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

// Store start/target and deltas globally (fixes undefined vars + allows snapping)
let wStart, bStart, wTarget, bTarget;
let wDelta, bDelta;

function createDeltas() {
	const [whitePts, blackPts] = points.children;

	wStart = new Float32Array(whitePts.geometry.attributes.position.array);
	bStart = new Float32Array(blackPts.geometry.attributes.position.array);
	wTarget = new Float32Array(whitePts.geometry.attributes.targetPosition.array);
	bTarget = new Float32Array(blackPts.geometry.attributes.targetPosition.array);

	wDelta = new Float32Array(wTarget.length);
	bDelta = new Float32Array(bTarget.length);

	for (let i = 0; i < wTarget.length; i++) wDelta[i] = wTarget[i] - wStart[i];
	for (let i = 0; i < bTarget.length; i++) bDelta[i] = bTarget[i] - bStart[i];
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
			fetch('./new-path-data.json').then((r) => r.json()),
			loader.loadAsync('../Models/stool_2.glb'),
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
		parent.children[0].material.metalness = .5;

		cane.position.set(0,-.35,0)

		scene.add(chair, brush, cane);
		console.log('scene', AnimationData.stool.length, scene);
	} catch (err) {
		console.error('Error loading glb model:', err);
	}
}

// --- create model particles for transition --- \\
function createParticles() {
	const counts = { white: 6000, black: 2000 };

	const materials = {
		white: new THREE.PointsMaterial({ size: 0.0125, sizeAttenuation: true, color: 0xE4E4E4 }),
		black: new THREE.PointsMaterial({ size: 0.0125, sizeAttenuation: true, color: 0x111111 }),
	};

	// Grab the meshes
	const chairWhiteMesh = chair.children[0].children[0];
	const chairBlackMesh = chair.children[0].children[1];
	const brushBodyMesh = brush.children[0];
	const brushTipMesh = brush.children[1];

	const sampler = {
		white: new MeshSurfaceSampler(chairWhiteMesh).build(),
		black: new MeshSurfaceSampler(chairBlackMesh).build(),
		brushBody: new MeshSurfaceSampler(brushBodyMesh).build(),
		brushTip: new MeshSurfaceSampler(brushTipMesh).build(),
	};

	function samplePoints(surfSampler, N) {
		const array = new Float32Array(N * 3);
		const v = new THREE.Vector3();
		for (let i = 0; i < N; i++) {
			surfSampler.sample(v);
			array.set([v.x, v.y, v.z], i * 3);
		}
		return array;
	}

	function makePointCloud(count, material, surfA, surfB) {
		const posA = samplePoints(surfA, count);
		const posB = samplePoints(surfB, count);

		const geometry = new THREE.BufferGeometry()
			.setAttribute('position', new THREE.BufferAttribute(posA, 3).setUsage(THREE.DynamicDrawUsage))
			.setAttribute('targetPosition', new THREE.BufferAttribute(posB, 3));

		geometry.computeBoundingSphere();

		const point = new THREE.Points(geometry, material);
		point.material.transparent = true;
		point.material.opacity = 0; // start invisible

		return point;
	}

	const pointsW = makePointCloud(counts.white, materials.white, sampler.white, sampler.brushBody);
	const pointsB = makePointCloud(counts.black, materials.black, sampler.black, sampler.brushTip);

	points = new THREE.Group();
	points.add(pointsW, pointsB);
	points.rotation.x = THREE.MathUtils.degToRad(90);

	// Start aligned with chair
	points.position.set(0, 0, -.14);
	points.visible = false; // IMPORTANT: start hidden (chair is first)

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
			const frame = AnimationData.stool[i];
			if (!frame) return;

			const { x, y, z } = frame;
			camera.position.set(x, y, z);
			camera.lookAt(brush.position); // ALWAYS in exact center => always look at it
		});
}

// Fade a model ↔ points
function fadeTween(model, shouldFade) {
	model.visible = true;
	points.visible = true;

	const modelIdx = model.name === 'chair' ? 1 : 0;
	const modelMats = fadeNodes.model[modelIdx];

	return new Tween.Tween({ t: 0 })
		.to({ t: 1 }, 2000)
		.easing(Easing.Quartic.Out)
		.onUpdate(({ t }) => {
			const modelOpacity = shouldFade ? 1 - t : t;
			const pointsOpacity = 1 - modelOpacity;

			modelMats.forEach((mat) => {
				mat.opacity = modelOpacity;
				mat.depthWrite = modelOpacity >= 0.99;
			});

			fadeNodes.points.forEach((mat) => {
				mat.opacity = pointsOpacity;
			});
		})
		.onComplete(() => {
			if (shouldFade) {
				// model -> points
				model.visible = false;
				points.visible = true;
			} else {
				// points -> model
				points.visible = false;
				model.visible = true;
			}
		});
}

// chat gpt is a good boy SOMETIMES
const BackIn = (s = 1.70158) => (k) => k * k * ((s + 1) * k - s);

// Points transition tween (chair <-> brush)
function transitionTween(toBrush) {
	const [whitePts, blackPts] = points.children;

	const startW = new Float32Array(whitePts.geometry.attributes.position.array);
	const startB = new Float32Array(blackPts.geometry.attributes.position.array);

	const deltaSign = toBrush ? 1 : -1;

	const startCol = whitePts.material.color.clone();
	const targetCol = toBrush ? state.colors[1] : state.colors[0]; // brush=orange, chair=white
	const { r: R, g: G, b: B } = targetCol;

	const zFrom = toBrush ? chair.position.z : brush.position.z;
	const zTo   = toBrush ? brush.position.z : chair.position.z;

	points.visible = true;

	return new Tween.Tween({ t: 0 })
		.to({ t: 1 }, 5000)
		.easing(Easing.Cubic.InOut) // IMPORTANT: keep orbit clean
		// .easing(Easing.Linear.None)
		.onUpdate(({ t }) => {
			// 1) morph easing (dramatic) applied manually
			const m = BackIn(6)(t);

			// 2) morph points (use eased 'm')
			const wPos = whitePts.geometry.attributes.position.array;
			const bPos = blackPts.geometry.attributes.position.array;

			for (let i = 0; i < wDelta.length; i++) wPos[i] = startW[i] + wDelta[i] * m * deltaSign;
			for (let i = 0; i < bDelta.length; i++) bPos[i] = startB[i] + bDelta[i] * m * deltaSign;

			whitePts.geometry.attributes.position.needsUpdate = true;
			blackPts.geometry.attributes.position.needsUpdate = true;

			// 3) color (use CLAMPED eased value so it doesn't go negative)
			const mc = THREE.MathUtils.clamp(m, 0, 1);
			whitePts.material.color.setRGB(
				startCol.r + (R - startCol.r) * mc,
				startCol.g + (G - startCol.g) * mc,
				startCol.b + (B - startCol.b) * mc
			);

			// 4) move point cloud between model z offsets (optional)
			points.position.z = zFrom + (zTo - zFrom) * mc;

			// 5) camera orbit
			if (t > 0) {
				const theta = 2 * Math.PI * t;
				camera.position.set(
					1.5 * Math.cos(theta),
					0,
					1.5 * Math.sin(theta),
				);
				camera.lookAt(brush.position);
			}
		})
		.onComplete(() => {
			// Snap points to exact endpoints to prevent drift
			const finalW = toBrush ? wTarget : wStart;
			const finalB = toBrush ? bTarget : bStart;

			whitePts.geometry.attributes.position.array.set(finalW);
			blackPts.geometry.attributes.position.needsUpdate = true;

			blackPts.geometry.attributes.position.array.set(finalB);
			blackPts.geometry.attributes.position.needsUpdate = true;

			whitePts.material.color.setRGB(R, G, B);

			points.position.z = zTo;

			// Force camera to end exactly at start
			camera.position.set(1.5, 0, 0);
		});
}


// The full loop: camera animation -> fade current model out + fade points in -> points morph -> fade next model in + fade points out
function runCycle() {
	const currentIdx = state.index; // 1 chair, 0 brush
	const nextIdx = 1 - currentIdx;

	const currentModel = currentIdx ? chair : brush;
	const nextModel = nextIdx ? chair : brush;

	// IMPORTANT: update lookAt target
	state.model = currentModel;

	// Build tweens
	const t1 = animationTween(AnimationData.stool.length);
	const t2 = fadeTween(currentModel, true);
	const t3 = transitionTween(nextIdx === 0); // next is brush?
	const t4 = fadeTween(nextModel, false);

	// IMPORTANT: sequential chaining (not all chained to t1)
	t1.chain(t2);
	t2.chain(t3);
	t3.chain(t4);

	t4.onComplete(() => {
		state.index = nextIdx;
		state.model = nextModel;
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
	createDeltas();

	// addUI();
	// camera.lookAt(brush.position);

	// initial visibility / opacity state
	chair.visible = true;
	brush.visible = false;

	// Make sure chair starts visible
	fadeNodes.model[1].forEach((m) => (m.opacity = 1));
	fadeNodes.model[0].forEach((m) => (m.opacity = 0));
	fadeNodes.points.forEach((m) => (m.opacity = 0));
	points.visible = false;

	state.model = chair;
	state.index = 1;

	animate();
	runCycle();
}


// --- Old helper functions --

// function addUI() {
// 	// minimal styles: bottom-right, out of the way
// 	const style = document.createElement('style');
// 	style.textContent = `
// 		.ui-panel{
// 			position:fixed; right:16px; bottom:16px; z-index:9999;
// 			display:grid; gap:8px; padding:10px; border-radius:10px;
// 			background:rgba(0,0,0,.55); color:#fff; font:500 13px/1 system-ui, sans-serif;
// 			user-select:none;
// 		}
// 		.ui-panel button{
// 			min-width:140px; padding:8px 10px; border-radius:8px; border:0; cursor:pointer;
// 			background:rgba(255,255,255,.1); color:#fff;
// 		}
// 		.ui-panel button:hover{ background:rgba(255,255,255,.18); }
// 	`;
// 	document.head.appendChild(style);

// 	const panel = document.createElement('div');
// 	panel.className = 'ui-panel';

// 	// buttons
// 	const bChair = document.createElement('button');
// 	bChair.textContent = 'Show Chair';
// 	bChair.onclick = () => {
// 		if (chair) { chair.visible = !chair.visible; }
// 	};

// 	const bBrush = document.createElement('button');
// 	bBrush.textContent = 'Show Brush';
// 	bBrush.onclick = () => {
// 		if (brush) { brush.visible = !brush.visible; }
// 	};
// 	const bCane = document.createElement('button');
// 	bCane.textContent = 'Show Cane';
// 	bCane.onclick = () => {
// 		if (cane) { cane.visible = !cane.visible; }
// 	};

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

// 	const bParticles = document.createElement('button');
// 	bParticles.textContent = 'Show Particles';
// 	bParticles.onclick = (e) => {
// 		// if (points) { points.visible = !points.visible; setOpacity(points, 1); }
// 		if (e) {
// 			let {x, y, z} = brush.position
// 			brush.position.set(x, y, z + .01)
// 			camera.lookAt(chair);
// 		}
// 	}

// 	const bParticlesTransparent = document.createElement('button');
// 	bParticlesTransparent.textContent = 'switch';
// 	bParticlesTransparent.onclick = () => {
// 		console.log(state.index);
// 		state.index = Number(!state.index);
// 	};

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

// 	panel.appendChild(bChair);
// 	panel.appendChild(bBrush);
// 	panel.appendChild(bCane);
// 	panel.appendChild(bCaneMesh);
// 	panel.appendChild(bMoveCam);
// 	panel.appendChild(bParticles);
// 	panel.appendChild(bParticlesTransparent)
// 	panel.appendChild(bAnimate);
// 	panel.appendChild(bFadeC);
// 	document.body.appendChild(panel);
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