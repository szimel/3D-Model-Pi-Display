import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import Stats from 'three/addons/libs/stats.module.js';
import { Tween, Easing } from 'three/addons/libs/tween.module.js';


let scene, camera, renderer, stats;
let chair, brush, points, AnimationData;
let frameCount = 0;

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
	camera.position.set(1, 1, 1);
	camera.lookAt(0, 0, 0);    

	scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
	const dir = new THREE.DirectionalLight(0xffffff, 1);
	dir.position.set(5, 5, 5);
	scene.add(dir);

	window.addEventListener('resize', () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	});
	document.addEventListener('keydown', onKeyDown);
};

function onKeyDown(event) {
	switch (event.keyCode) {
	case 79: // O
		const lookingAt = new THREE.Vector3();
		camera.getWorldDirection(lookingAt)
		camera.lookAt(points.position)
		break;
	case 80: // P
		const idk = new THREE.Vector3();
		camera.getWorldDirection(idk)
		// camera.lookAt(idk.x, idk.y + .33, idk.z)
		camera.lookAt(points);
		break;
	}
}


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

		// orient & position your models
		chair.rotation.x = THREE.MathUtils.degToRad(90);
		brush.position.set(-1.766, 0.918, 1.118);
		brush.visible = false;

		scene.add(chair, brush);
		console.log('scene', scene);

	}catch (err) {
		console.error('Error loading glb model:', err);
	};
};


// --- create model particles for transition --- \\
function createParticles() {
	const numParticles = 3500;
	const chairMesh = scene.children[2].children[0].children[0];
	const brushMesh = scene.children[3].children[0];
	const material = new THREE.PointsMaterial({
		size: .01,
		sizeAttenuation: true,
		color: 0x999999
	});

	const chairSurface = new MeshSurfaceSampler(chairMesh).build();
	const brushSurface = new MeshSurfaceSampler(brushMesh).build();

	const posChair = new Float32Array(numParticles * 3); // large container, stores w/ indices
	const posBrush = new Float32Array(numParticles * 3);
	const tempPos = new THREE.Vector3();

	for (let i = 0; i < numParticles; i++) { // grabs & stores random position along chair,brush surface
		chairSurface.sample(tempPos);
		posChair.set([tempPos.x, tempPos.y, tempPos.z], i * 3);
		brushSurface.sample(tempPos);
		posBrush.set([tempPos.x, tempPos.y, tempPos.z], i * 3);
	}

	const pointMesh = new THREE.BufferGeometry();
	pointMesh.setAttribute('position', new THREE.BufferAttribute(posChair, 3));
	pointMesh.setAttribute('targetPosition', new THREE.BufferAttribute(posBrush, 3));
	pointMesh.setDrawRange(0, numParticles);
	pointMesh.computeBoundingSphere();

	points = new THREE.Points(pointMesh, material);
	points.frustumCulled = false; 
	
	points.rotation.x = THREE.MathUtils.degToRad(90); // spawns in annoying
	points.position.set(-1.1776, 0.918, 0.918)
	points.visible = false;

	scene.add(points);
};



// --- load everything in order --- \\
init();
async function init() {
	setup();
	await loadAssets();
	createParticles();
	handleAnimations();
}



// --- manages animation sequence -- \\
function handleAnimations() {
	//TODO: Switch statement w global var tracking current animation? 
	chairAnimation(); // ends with camera facing chair from front on
	// transitionAnimation();
}


function chairAnimation() {
	stats.update();

	const position = AnimationData.stool[frameCount];
	const chairPos = scene.children[2].position;

	chairPos.set(position.x, position.y, position.z);
	camera.lookAt(chairPos);

	renderer.render(scene, camera);

	if(frameCount == AnimationData.stool.length -1) {
		frameCount = 0;
		return transitionAnimation();
	} else {
		frameCount ++;
		requestAnimationFrame(chairAnimation);

	}
}

function transitionAnimation() {
	chair.visible = false;
	brush.visible = false;
	points.visible = true;

	const positions = points.geometry.attributes.position.array
	const targets = scene.children[4].geometry.attributes.targetPosition.array;

	if(frameCount < 25) {
		frameCount ++;
		console.log(((Math.log10(frameCount) ** 2)/45) + 1)
		for (let i = 0; i < positions.length; i++) {
			positions[i] = positions[i] * (((Math.log10(frameCount) ** 2)/45) + 1)
			
		}

	} else {
		for (let i = 0; i < positions.length; i++) {
			positions[i] = THREE.MathUtils.lerp(positions[i], targets[i], .1);
		}
	}

	scene.children[4].geometry.attributes.position.needsUpdate = true;
	renderer.render(scene, camera);

	requestAnimationFrame(transitionAnimation)
}