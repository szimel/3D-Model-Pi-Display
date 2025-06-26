import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import Stats from 'three/addons/libs/stats.module.js';
import Tween, {Easing} from 'https://unpkg.com/@tweenjs/tween.js@23.1.3/dist/tween.esm.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';


let scene, camera, renderer, stats, controls;
let chair, brush, points, AnimationData;
let frameCount = 0;
let state = 'chair' | 'brush' | 'transition';
state = 'chair';



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

	controls = new OrbitControls(camera, renderer.domElement);

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
			loader.loadAsync('../../Models/stool.glb'),
			loader.loadAsync('../../Models/brush.glb')
		]);

		AnimationData = json;
		chair = chairGLB.scene;
		brush = brushGLB.scene;

		// manual orientation bc i suck at blender
		chair.rotation.x = THREE.MathUtils.degToRad(90);
		// chair.position.set(0, 0, 0);
		// brush.position.set(-1.766, 0.918, 1.118);
		brush.visible = false;

		scene.add(chair, brush);
		console.log('scene', scene);

	}catch (err) {
		console.error('Error loading glb model:', err);
	};
};


// --- create model particles for transition --- \\
function createParticles() {
	// config
	const counts = { white: 4000, black: 1500 };
	const materials = {
		white: new THREE.PointsMaterial({ size: .0125, sizeAttenuation: true, color: 0x999999 }),
		black: new THREE.PointsMaterial({ size: .0125, sizeAttenuation: true, color: 0x111111 })
	};

	const chairWhiteMesh = chair.children[0].children[0];
	const chairBlackMesh = chair.children[0].children[1];
	const brushMesh = brush.children[0];

	const sampler = {
		white: new MeshSurfaceSampler(chairWhiteMesh).build(),
		black: new MeshSurfaceSampler(chairBlackMesh).build(),
		brush: new MeshSurfaceSampler(brushMesh).build()
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

		return new THREE.Points(geometry, material);
	}

	const pointsW = makePointCloud(counts.white, materials.white, sampler.white, sampler.brush);
	const pointsB = makePointCloud(counts.black, materials.black, sampler.black, sampler.brush);

	// group & position them together
	points = new THREE.Group();
	points.add(pointsW, pointsB);
	points.rotation.x = THREE.MathUtils.degToRad(90);
	points.position.set(-1.7, 0.922, 0.918);
	points.visible = false;

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


let transitionStarted = true;
// --- --- \\
function animate(time) {
	requestAnimationFrame(animate);
	stats.update();
	Tween.update(time);

	switch(state) {
		case 'chair': updateChair(); break;
		case 'transition': {
			if(transitionStarted) {
				console.log('rIRANIRANIRANIRAN&&&&&&&&&&&&&&&&&&&&&&&&&&&&an')
				transitionStarted = false;
				startTweenTransition();
			}
			break;
		}
		case 'brush': return;
	}

	renderer.render(scene, camera);
}

const array = [];

function updateChair() {
	const path = AnimationData.stool;
	if (frameCount < path.length) {
		const { x, y, z } = path[frameCount++];
		chair.position.set(x, y, z);
		camera.lookAt(chair.position);

	} else {
		frameCount = 1;
		state = 'transition';
	}
}

function startTweenTransition() {
	// hide the originals
	chair.visible = brush.visible = false;
	points.visible = true;

	// capture initial & target arrays for each point
	let startW = points.children[0].geometry.attributes.position;
	let startB = points.children[1].geometry.attributes.position;
	const targetW = points.children[0].geometry.attributes.targetPosition.array;
	const targetB = points.children[1].geometry.attributes.targetPosition.array;

	new Tween.Tween({ t:0 })
		.to({ t: 1 }, 8000)
		.easing(Easing.Exponential.Out)
		.onUpdate(o => {
		function calcStep(start, targetArr) {
			for (let i = 0; i < start.array.length; i++) {
				const endPos = THREE.MathUtils.lerp(start.array[i], targetArr[i], o.t);
				start.array[i] = endPos;
			}

			// 	// points.position.set(-1.7, 0.922, 0.918);
			// // const {x, y, z} = {x: -1.7, y: 0.922, z:.918};
			// const {x, y, z} = points.position;
			// points.position.set(x + .01, y, z + o.t/2);
			// // console.log(x + o.t/10)
			// camera.lookAt(points.position);
			// start.needsUpdate = true;

			return start;
		}

		console.log('cam', camera.position);
		console.log('brush', brush.position);
		
		startW = calcStep(startW, targetW);
		startB = calcStep(startB, targetB);

		// camera moves in a circle, don't have to center on brush because on same y level. Just tell it to look at it
		const circleRadius = 2;
		const circleSpeed  = 2;  

		const theta = o.t * Math.PI;
		camera.position.x = brush.position.x + circleRadius * Math.cos(theta);
		camera.position.z = brush.position.z + circleRadius * Math.sin(theta);
		camera.lookAt(brush.position);

		}).onComplete(() => {
			state = 'brush';
		})
		.start();
}