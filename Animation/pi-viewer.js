import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import Stats from 'three/addons/libs/stats.module.js';
import { Tween, Easing } from 'three/addons/libs/tween.module.js';


let scene, camera, renderer, stats;
let chair, brush, points, AnimationData;
let currentFrame = 0;

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
	const numParticles = 2500;
	const chairMesh = scene.children[2].children[0].children[0];
	const brushMesh = scene.children[3].children[0];
	const material = new THREE.PointsMaterial({
		size: .05,
		sizeAttenuation: true,
		color: 0x999999
	});

	const chairSurface = new MeshSurfaceSampler(chairMesh).build();
	const brushSurface = new MeshSurfaceSampler(brushMesh).build();

	// const chairPoints = new THREE.InstancedMesh(chairSurface.geometry, material, numParticles);
	// const brushPoints = new THREE.InstancedMesh(brushSurface.geometry, material, numParticles);

	// const posChair = new THREE.Vector3();
	// const posBrush = new THREE.Vector3();

	// const matrixC = new THREE.Matrix3();
	// const matrixB = new THREE.Matrix3();
	
	// for ( let i = 0; i < numParticles; i ++ ) { // map rand points on model's surface
	// 	chairSurface.sample(posChair);
	// 	brushSurface.sample(posBrush);

	// 	matrixC.makeTranslation(posChair.x, posChair.y, posChair.z);
	// 	matrixB.makeTranslation(posBrush.x, posBrush.y, posBrush.z);

	// 	console.log(matrixC)

	// 	chairPoints.setMatrixAt( i, matrixC );
	// 	brushPoints.setMatrixAt(i, matrixB);
	// }

	// console.log(chairPoints)

	const posChair = new Float32Array(numParticles * 3); // large container, stores w/ indices
	const posBrush = new Float32Array(numParticles * 3);
	const tempPos = new THREE.Vector3();

	for (let i = 0; i < numParticles; i++) { // grabs & stores random position along chair,brush surface
		chairSurface.sample(tempPos);
		posChair.set([tempPos.x, tempPos.y, tempPos.z], i * 3);
		brushSurface.sample(tempPos);
		posBrush.set([tempPos.x, tempPos.y, tempPos.z], i * 3);
	}

	console.log('posChair', posChair);
	console.log('posBrush', posBrush);

	const pointMesh = new THREE.BufferGeometry();
	pointMesh.setAttribute('position', new THREE.BufferAttribute(posChair, 3));
	pointMesh.setAttribute('targetPosition', new THREE.BufferAttribute(posBrush, 3));
	pointMesh.setDrawRange(0, numParticles);
	pointMesh.computeBoundingSphere();

	console.log(pointMesh);

	points = new THREE.Points(pointMesh, material);
	points.frustumCulled = false; 
	
	points.rotation.x = THREE.MathUtils.degToRad(90); // spawns in annoying
	points.position.set(-1.1776, 0.918, 0.918)

	scene.add(points);
	console.log(points);
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

	const position = AnimationData.stool[currentFrame];
	const chairPos = scene.children[2].position;

	chairPos.set(position.x, position.y, position.z);
	camera.lookAt(chairPos);

	renderer.render(scene, camera);

	if(currentFrame == AnimationData.stool.length -1) {
		return transitionAnimation();
	} else {
		currentFrame ++;
		requestAnimationFrame(chairAnimation);

	}
}

function transitionAnimation() {
	chair.visible = false;
	brush.visible = false;


	const positions = points.geometry.attributes.position.array
	const targets = scene.children[4].geometry.attributes.targetPosition.array;


	for (let i = 0; i < positions.length; i++) {
		// console.log(positions[i]);
		// positions[i] = positions[i] * 1.01
		positions[i] = THREE.MathUtils.lerp(positions[i], targets[i], .1);
	}

	// positions.map((position, index) => {
	// 	position = THREE.MathUtils.lerp(position, targets[index], 1);
	// })
	scene.children[4].geometry.attributes.position.needsUpdate = true;
	renderer.render(scene, camera);

	requestAnimationFrame(transitionAnimation)
}

		// new Tween({ t: 0 })
		// 	.to({ t: 1 }, 2000)
		// 	.easing(Easing.Cubic.InOut)
		// 	.onUpdate(({ t }) => {
		// 		const pAttr = pointMesh.attributes.position.array;
		// 		const tgt = pointMesh.attributes.targetPosition.array;
		// 		for (let i = 0; i < pAttr.length; i++) {
		// 			pAttr[i] = THREE.MathUtils.lerp(posA[i], tgt[i], t);
		// 		}
		// 		geo.attributes.position.needsUpdate = true;
		// 	})
		// 	.start();

	function swapModelAnimation () {
		const N = 500;
		const chairMesh = scene.children[2].children[0].children[0];
		const brushMesh = scene.children[3].children[0];

		const chairSurface = new MeshSurfaceSampler(chairMesh).build();
		const brushSurface = new MeshSurfaceSampler(brushMesh).build();

		const posA = new Float32Array(N * 3);
		const posB = new Float32Array(N * 3);
		const tempPos = new THREE.Vector3();
		
		for (let i = 0; i < N; i++) {
			chairSurface.sample(tempPos);
			posA.set([tempPos.x, tempPos.y, tempPos.z], i * 3);
			brushSurface.sample(tempPos);
			posB.set([tempPos.x, tempPos.y, tempPos.z], i * 3);
		}

		// Build the particle geometry
		const pointMesh = new THREE.BufferGeometry();
		pointMesh.setAttribute('position', new THREE.BufferAttribute(posA.slice(), 3).setUsage( THREE.DynamicDrawUsage ));
		pointMesh.setAttribute('targetPosition', new THREE.BufferAttribute(posB, 3));
		pointMesh.setDrawRange(0, N);
		pointMesh.computeBoundingSphere();

		const material = new THREE.PointsMaterial({
			size: 0.05,
			sizeAttenuation: true,
			color: 0x32cd32
		});

		const particles = new THREE.Points(pointMesh, material);
		particles.frustumCulled = false; 
		particles.geometry.attributes.position.needsUpdate = true;
		scene.add(particles);

		// Hide originals
		scene.children[2].visible = false;
		scene.children[3].visible = false;


		renderer.render(scene, camera);

		// 3️⃣ Optional “scatter” before reform:
		//    you could loop over geo.attributes.position.array
		//    and move them along a random dir × some radius

		// 4️⃣ Tween from A→B
		// new Tween({ t: 0 })
		// 	.to({ t: 1 }, 2000)
		// 	.easing(Easing.Cubic.InOut)
		// 	.onUpdate(({ t }) => {
		// 		const pAttr = pointMesh.attributes.position.array;
		// 		const tgt = pointMesh.attributes.targetPosition.array;
		// 		for (let i = 0; i < pAttr.length; i++) {
		// 			pAttr[i] = THREE.MathUtils.lerp(posA[i], tgt[i], t);
		// 		}
		// 		geo.attributes.position.needsUpdate = true;
		// 	})
		// 	.start();
		console.log(scene);
						const p = pointMesh.attributes.position.array;
				const tgt = pointMesh.attributes.targetPosition.array;
				console.log('p and tgt', p, '\n', tgt)

		new Tween({ t: 0 })
			.to({ t: 1 }, 2000)
			.easing(Easing.Cubic.InOut)
			.onUpdate(function(o) {
				const p = pointMesh.attributes.position.array;
				const tgt = pointMesh.attributes.targetPosition.array;
				console.log('p and tgt', p, '\n', tgt)
				for (let i = 0; i < p.length; i++) {
					p[i] = THREE.MathUtils.lerp(posA[i], tgt[i], o.t);
				}
				geometry.attributes.position.needsUpdate = true;
			}).start();

			console.log(Tween);

			console.log('finished?');
			Animate();
}

			function Animate() {
				requestAnimationFrame(Animate);
				// console.log(Tween);
				// Tween.update();      // drive the tween each frame
				// stats.update();
				renderer.render(scene, camera);
			}

	// then make sure your animate loop looks like this:
// new GLTFLoader().load(
//   '../../Models/stool_2.glb',
//   (gltf) => {
// 		// Loads model
//     model = gltf.scene;
// 		model.rotation.x = THREE.MathUtils.degToRad( 90 )
//     scene.add(model);

// 		// sets x,y,z position vector.... seems to acts as a scalar and modifier of "path" of 
// 		// animation, depending on input values. I truly don't understand how the position of the 
// 		// camera can affect the rotation of the glb.... 
// 		camera.position.set(1, 1, 1)

//     animate();
//   },
//   undefined,
//   (err) => console.error(err)
// );

// keep everything sized on window resize

