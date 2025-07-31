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
			loader.loadAsync('../../Models/brush_2.glb')
		]);

		AnimationData = json;
		chair = chairGLB.scene;
		brush = brushGLB.scene;

		// manual orientation bc i suck at blender
		chair.rotation.x = THREE.MathUtils.degToRad(90);
		// chair.position.set(-0.046, -1, -1.995); // chair animation start frame location
		// brush.position.set(-0.046, -1, -1.8); // a little offset because (0,0,0) isn't middle of chair animation
		brush.rotation.x = THREE.MathUtils.degToRad(90);

		// updates values scene uses? 
		chair.updateMatrixWorld(true);
		brush.updateMatrixWorld(true);


		scene.add(chair, brush);
		console.log('scene', AnimationData.stool.length, scene);
		brush.visible = true;


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

	// models both have two different sections. Grab them here
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

		return new THREE.Points(geometry, material);
	}

	const pointsW = makePointCloud(counts.white, materials.white, sampler.white, sampler.brushBody);
	const pointsB = makePointCloud(counts.black, materials.black, sampler.black, sampler.brushTip);

	// set transparency here (for later animations)
	pointsW.material.transparent = true;
	pointsW.material.opacity = 0;
	pointsB.material.transparent = true;
	pointsB.material.opacity = 0;
	chairWhiteMesh.material.transparent = true;
	chairBlackMesh.material.transparent = true;

	// group & position them together
	points = new THREE.Group();
	points.add(pointsW, pointsB);
	points.rotation.x = THREE.MathUtils.degToRad(90);
	points.position.set(-0.046, -1, -1.995); // match end frame of chair animation
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


let transitionStarted = false;
// --- --- \\
function animate(time) {
	requestAnimationFrame(animate);
	stats.update();
	Tween.update(time);

	switch(state) {
		case 'chair': {
			updateChair();
			break;
		}
		case 'transition': {
			if(!transitionStarted) {
				transitionStarted = true;
				startTweenTransition();
			}
			break;
		}
		case 'brush': {
			return;
		}
	}

	renderer.render(scene, camera);
}

function updateChair() {
	const path = AnimationData.stool;
	if (frameCount < path.length) {
		const { x, y, z } = path[frameCount++];
		chair.position.set(x, y, z);
		camera.lookAt(chair.position);

		// transparency switch of chair + chair points
		if(frameCount > AnimationData.stool.length - 200) {
			points.visible = true;
			points.position.set(x, y, z); // HERE, points aren't visible? 

			chair.children[0].children.map(child => child.material.opacity = Math.max(0, child.material.opacity - .005));
			points.children.map(child => child.material.opacity = Math.min(1, child.material.opacity + .005));
			console.log(points.children[0].material.opacity);
		}
	} else {
		chair.visible = false;
		frameCount = 0;
		state = 'transition';
	}
}

function startTweenTransition() {
	// capture target arrays + color
	const targetW = points.children[0].geometry.attributes.targetPosition.array;
	const targetB = points.children[1].geometry.attributes.targetPosition.array;
	const targetColor = {
		"r": 0.04817182422013895,
		"g": 0.04817182422013895,
		"b": 0.04817182422013895
	}

	new Tween.Tween({ t:0 })
		.to({ t: .05 }, 8000)
		.easing(Easing.Exponential.Out)
		.onUpdate(o => {
		function calcStep(startMesh, targetArr) {
			let posArr = startMesh.geometry.attributes.position.array;
			let startColor = startMesh.material.color;

			for (let i = 0; i < posArr.length; i++) {
				const endPos = THREE.MathUtils.lerp(posArr[i], targetArr[i], o.t);
				posArr[i] = endPos;
			}
			const r = THREE.MathUtils.lerp(startColor.r, targetColor.r, o.t);
			const g = THREE.MathUtils.lerp(startColor.g, targetColor.g, o.t);
			const b = THREE.MathUtils.lerp(startColor.b, targetColor.b, o.t);
			startColor.setRGB(r, g, b);

			startMesh.geometry.attributes.position.needsUpdate = true;
		}
		
		calcStep(points.children[0], targetW);
		calcStep(points.children[1], targetB);

		frameCount++;

		}).onComplete(() => {
			state = 'brush';
		})
		.start();
}


// /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
// --disable-web-security \
// --user-data-dir="/tmp/chrome-dev-disable-cors" \
// --allow-file-access-from-files \                                                --enable-precise-memoryinfo \
// file:///Users/samuel/code/Elijah/Pi-code/Animation/camera.html