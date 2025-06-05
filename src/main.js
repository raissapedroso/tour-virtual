import * as THREE from 'three';
import {VRButton} from 'three/examples/jsm/webxr/VRButton.js';
import {scenesData} from "./scenes/scenesData.js";// seu JSON acima

let camera, scene, renderer;
let controller;
let raycaster, tempMatrix;
let hotspotMeshes = [];
let currentPanoramaMesh = null;

init();
loadScene('panorama1');
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 0);

    const light = new THREE.HemisphereLight(0xffffff, 0x444444);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    raycaster = new THREE.Raycaster();
    raycaster.camera = camera; // 🔧 ESSENCIAL para sprites
    tempMatrix = new THREE.Matrix4();

    controller = renderer.xr.getController(0);
    controller.addEventListener('selectstart', onSelectStart);
    scene.add(controller);


    const geometryLine = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const materialLine = new THREE.LineBasicMaterial({color: 0xffffff});
    const line = new THREE.Line(geometryLine, materialLine);
    line.name = 'ray';
    line.scale.z = 10;
    controller.add(line);

    window.addEventListener('resize', onWindowResize);
}

function loadScene(sceneName) {
    const data = scenesData[sceneName];

    if (currentPanoramaMesh) {
        scene.remove(currentPanoramaMesh);
        currentPanoramaMesh.geometry.dispose();
        currentPanoramaMesh.material.map.dispose();
        currentPanoramaMesh.material.dispose();
    }

    hotspotMeshes.forEach(mesh => {
        scene.remove(mesh);
        mesh.geometry?.dispose?.();
        mesh.material?.dispose?.();
    });
    hotspotMeshes = [];

    const geometry = new THREE.SphereGeometry(50, 64, 64);
    geometry.scale(-1, 1, 1);
    const texture = new THREE.TextureLoader().load(data.image);
    const material = new THREE.MeshBasicMaterial({map: texture});
    currentPanoramaMesh = new THREE.Mesh(geometry, material);
    currentPanoramaMesh.userData.ignoreRaycast = true;
    scene.add(currentPanoramaMesh);

    data.hotspots.forEach(hotspot => {
        const spriteMaterial = new THREE.SpriteMaterial({color: 0xffff00});
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(hotspot.position.x, hotspot.position.y, hotspot.position.z);
        sprite.scale.set(2, 2, 1);
        sprite.userData.target = hotspot.target;
        hotspotMeshes.push(sprite);
        scene.add(sprite);
    });
}

function onSelectStart() {
    const intersects = raycaster.intersectObjects(hotspotMeshes, false);
    if (intersects.length > 0) {
        const target = intersects[0].object.userData.target;
        if (target) loadScene(target);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    if (!controller) return; // ✅ Garante que controller existe

    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(hotspotMeshes, false);

    hotspotMeshes.forEach(mesh => {
        mesh.material.color.set(0xffff00); // padrão
    });
    if (intersects.length > 0) {
        intersects[0].object.material.color.set(0xff0000); // hover
    }

    renderer.render(scene, camera);
}