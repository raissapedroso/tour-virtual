import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { scenesData } from './scenes/scenesData.js';





let camera, scene, renderer;
let controller1, controller2;
let controls;
let raycaster, tempMatrix;
let hotspotMeshes = [];
let currentPanoramaMesh = null;


let fadePlane, fadeOpacity = 0, fading = false, fadeDirection = 1, fadeCallback = null;
const clock = new THREE.Clock();


const mouse = new THREE.Vector2();
let savedCameraQuaternion = new THREE.Quaternion();


init();
loadScene('panorama0');
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Câmera do usuário
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 0); // Altura média dos olhos
    camera.lookAt(new THREE.Vector3(0, 1.6, -1)); // Olhar para frente


    const light = new THREE.HemisphereLight(0xffffff, 0x444444);
    scene.add(light);


    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true; // Ativa XR (VR)
    renderer.xr.setReferenceSpaceType('local-floor');


    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    // Controles de mouse (modo não-VR)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1;
    controls.maxDistance = 100;
    controls.dampingFactor = 0.2;
    controls.rotateSpeed = -0.3;
    controls.target.set(0, 1.6, -1); // Olhar fixo para frente
    controls.update();

    // Raycaster para detectar cliques nos hotspots
    raycaster = new THREE.Raycaster();
    tempMatrix = new THREE.Matrix4();

    // Controladores VR
    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStart);
    scene.add(controller2);

    // Linhas laser nos controles VR
    [controller1, controller2].forEach(controller => {
        const geometryLine = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1)
        ]);
        const materialLine = new THREE.LineBasicMaterial({ color: 0xffffff });
        const line = new THREE.Line(geometryLine, materialLine);
        line.name = 'ray';
        line.scale.z = 10;
        controller.add(line);
    });


    const fadeGeometry = new THREE.PlaneGeometry(2, 2);
    const fadeMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false
    });
    fadePlane = new THREE.Mesh(fadeGeometry, fadeMaterial);
    fadePlane.renderOrder = 999;
    fadePlane.frustumCulled = false;
    scene.add(fadePlane);


    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointerdown', onPointerDown);
}


function startFade(direction, callback) {
    fadeDirection = direction;
    fadeCallback = callback;
    fading = true;
}


function loadScene(sceneName) {
    const data = scenesData[sceneName];
    if (!data) {
        console.warn(`Cena "${sceneName}" não encontrada.`);
        return;
    }


    savedCameraQuaternion.copy(camera.quaternion);


    if (currentPanoramaMesh) {
        scene.remove(currentPanoramaMesh);
        currentPanoramaMesh.geometry.dispose();
        if (currentPanoramaMesh.material.map) currentPanoramaMesh.material.map.dispose();
        currentPanoramaMesh.material.dispose();
        currentPanoramaMesh = null;
    }

    // Remove hotspots antigos
    hotspotMeshes.forEach(mesh => {
        scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
    });
    hotspotMeshes = [];


    const geometry = new THREE.SphereGeometry(50, 128, 128);
    geometry.scale(-1, 1, 1); // Inverter


    const texture = new THREE.TextureLoader().load(data.image);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    currentPanoramaMesh = new THREE.Mesh(geometry, material);
    currentPanoramaMesh.userData.ignoreRaycast = true;
    scene.add(currentPanoramaMesh);


    data.hotspots.forEach(hotspot => {
        let material;
        if (hotspot.icon) {
            const hotspotTexture = new THREE.TextureLoader().load(hotspot.icon);
            material = new THREE.SpriteMaterial({ map: hotspotTexture, transparent: true, alphaTest: 0.01 });
        } else {
            material = new THREE.SpriteMaterial({ color: 0xffff00 });
        }

        const sprite = new THREE.Sprite(material);
        sprite.position.set(hotspot.position.x, hotspot.position.y, hotspot.position.z);
        sprite.scale.set(2.5, 2.5, 1);
        sprite.userData.target = hotspot.target;
        hotspotMeshes.push(sprite);
        scene.add(sprite);
    });


    if (!renderer.xr.isPresenting) {
        camera.quaternion.copy(savedCameraQuaternion);
    }
}

// Evento de clique com controle VR
function onSelectStart(event) {
    const controller = event.target;
    tempMatrix.identity().extractRotation(controller.matrixWorld);

    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(hotspotMeshes, false);
    if (intersects.length > 0) {
        const target = intersects[0].object.userData.target;
        if (target) {
            startFade(1, () => {
                loadScene(target);
                startFade(-1);
            });
        }
    }
}

// Evento de clique do mouse ou toque
function onPointerDown(event) {
    if (renderer.xr.isPresenting) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(hotspotMeshes, false);
    if (intersects.length > 0) {
        const target = intersects[0].object.userData.target;
        if (target) {
            startFade(1, () => {
                loadScene(target);
                startFade(-1);
            });
        }
    }
}

// Atualiza resolução da tela
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Inicia o loop de animação
function animate() {
    renderer.setAnimationLoop(render);
}

// Função de renderização
function render() {
    const delta = clock.getDelta(); // Tempo entre frames


    if (fading) {
        fadeOpacity += fadeDirection * delta * 2;
        fadeOpacity = THREE.MathUtils.clamp(fadeOpacity, 0, 1);
        fadePlane.material.opacity = fadeOpacity;

        if ((fadeDirection === 1 && fadeOpacity >= 1) || (fadeDirection === -1 && fadeOpacity <= 0)) {
            fading = false;
            if (fadeCallback) {
                const cb = fadeCallback;
                fadeCallback = null;
                cb();
            }
        }
    }


    fadePlane.position.copy(camera.position);
    fadePlane.quaternion.copy(camera.quaternion);
    fadePlane.translateZ(-0.5);


    if (!renderer.xr.isPresenting && controls) controls.update();


    hotspotMeshes.forEach(mesh => {
        if (mesh.material.color) mesh.material.color.set(0xffff00);
    });


    if (renderer.xr.isPresenting) {
        checkIntersection(controller1);
        checkIntersection(controller2);
    }

    renderer.render(scene, camera);
}


function checkIntersection(controller) {
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(hotspotMeshes, false);
    if (intersects.length > 0) {
        const material = intersects[0].object.material;
        if (material.color) material.color.set(0xff0000);
    }
}
