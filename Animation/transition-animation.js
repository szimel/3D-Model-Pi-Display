import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SurfaceSampler } from 'three/addons/math/SurfaceSampler.js';
import { Tween, Easing } from 'https://cdn.jsdelivr.net/npm/@tweenjs/tween.js@18.6.4/dist/tween.umd.js';

const N = 5000;
const loader = new GLTFLoader();
Promise.all([
  loader.loadAsync('../../Models/stool_2.glb'),
  loader.loadAsync('../../Models/PEN.glb')
]).then(([gltfA, gltfB]) => {
  const meshA = gltfA.scene.children[0];
  const meshB = gltfB.scene.children[0];

  // 1️⃣ Sample N points from each
  const samplerA = new SurfaceSampler(meshA).build();
  const samplerB = new SurfaceSampler(meshB).build();
  const posA = new Float32Array(N * 3);
  const posB = new Float32Array(N * 3);
  const tempPos = new THREE.Vector3();
  
  for (let i = 0; i < N; i++) {
    samplerA.sample(tempPos);
    posA.set([tempPos.x, tempPos.y, tempPos.z], i * 3);
    samplerB.sample(tempPos);
    posB.set([tempPos.x, tempPos.y, tempPos.z], i * 3);
  }

  // 2️⃣ Build the particle geometry
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posA.slice(), 3));
  geo.setAttribute('targetPosition', new THREE.BufferAttribute(posB, 3));

  const mat = new THREE.PointsMaterial({ size: 0.02, color: 0xffffff });
  const particles = new THREE.Points(geo, mat);
  scene.add(particles);

  // 3️⃣ Optional “scatter” before reform:
  //    you could loop over geo.attributes.position.array
  //    and move them along a random dir × some radius

  // 4️⃣ Tween from A→B
  new Tween({ t: 0 })
    .to({ t: 1 }, 2000)
    .easing(Easing.Cubic.InOut)
    .onUpdate(({ t }) => {
      const pAttr = geo.attributes.position.array;
      const tgt = geo.attributes.targetPosition.array;
      for (let i = 0; i < pAttr.length; i++) {
        pAttr[i] = THREE.MathUtils.lerp(posA[i], tgt[i], t);
      }
      geo.attributes.position.needsUpdate = true;
    })
    .start();

});
