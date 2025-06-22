// The code that generated the path and stored it in json for the stool model, for reference but mainly to showboat
// render loop, specific to stool_2
function animate() {
	if(count < 757) {
	requestAnimationFrame(animate);
	const r = Date.now() * 0.0005;
	stats.update(); // REMOVE IN PROD
	count ++;

	// Move pivot (mesh) using original sin/cos logic
	let gltf = scene.children[2].position
	gltf.x = 2 * (Math.round(Math.cos(r) * 1000)/1000);
	gltf.y = 2 * (Math.round(Math.sin(r) * 1000)/1000);
	gltf.z = 2 * (Math.round(Math.sin(r) * 1000)/1000);

	modelAnimationData[count] = new THREE.Vector3(gltf.x, gltf.y, gltf.z)

	camera.lookAt(gltf);

	renderer.render(scene, camera);
	} else {
		console.log(modelAnimationData)
	}
	// console.log(modelAnimationData)
}