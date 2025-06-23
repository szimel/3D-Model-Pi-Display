import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import Stats from 'three/addons/libs/stats.module.js';

//grab path data on load
let AnimationData;
fetch('./path-data.json')
  .then(response => response.json())
  .then(data => {
    AnimationData = data;
		console.log(AnimationData);
});

let currentFrame = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xD2B48C); // tan

let stats = new Stats();
document.body.appendChild(stats.dom)

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  10
);

// basic—but bright—lighting
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
const dir = new THREE.DirectionalLight(0xffffff, 1);
dir.position.set(5, 5, 5);
scene.add(dir);

let model;

new GLTFLoader().load(
  '../../Models/stool_2.glb',
  (gltf) => {
		// Loads model
    model = gltf.scene;
		model.rotation.x = THREE.MathUtils.degToRad( 90 )
    scene.add(model);

		// sets x,y,z position vector.... seems to acts as a scalar and modifier of "path" of 
		// animation, depending on input values. I truly don't understand how the position of the 
		// camera can affect the rotation of the glb.... 
		camera.position.set(1, 1, 1)

    animate();
  },
  undefined,
  (err) => console.error(err)
);

function animate() {
	stats.update();

	let position = AnimationData.stool[currentFrame];
	let gltf = scene.children[2].position;

	gltf.set(position.x, position.y, position.z);
	camera.lookAt(gltf);

	renderer.render(scene, camera);


	if(currentFrame == 755) {return todo()};
	currentFrame ++;

	requestAnimationFrame(animate);
};

function todo() {
	// this will eventually handle transitions between the two models
	console.log('got here')
}

// keep everything sized on window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
