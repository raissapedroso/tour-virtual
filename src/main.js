import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { carregarTodasAsCenas } from './scenes/scenesFetcher.js';

let camera, scene, renderer, controls, raycaster, tempMatrix;
let hotspotMeshes = [];
let currentPanoramaMesh = null;
let fadePlane, fadeOpacity = 0, fading = false, fadeDirection = 1, fadeCallback = null;
const clock = new THREE.Clock();
const mouse = new THREE.Vector2();
let savedCameraQuaternion = new THREE.Quaternion();
let scenesData = {};
let controller1, controller2;

const textureCache = {};
const textureLoader = new THREE.TextureLoader();

init();

// Registra cenas recursivamente na cena geral
function registrarCenasRecursivamente(cena) {
    if (!cena || scenesData[`panorama${cena.id}`]) return;
    scenesData[`panorama${cena.id}`] = cena;
    for (const hotspot of cena.hotspots || []) {
        if (hotspot.cena_destino) {
            registrarCenasRecursivamente(hotspot.cena_destino);
        }
    }
}

// Pré-carrega as texturas para evitar delays no render
async function preloadTextures(cena) {
    if (!cena || textureCache[`panorama${cena.id}`]) return;

    textureCache[`panorama${cena.id}`] = await textureLoader.loadAsync(cena.image);

    for (const hotspot of cena.hotspots || []) {
        if (hotspot.icon && !textureCache[hotspot.icon]) {
            textureCache[hotspot.icon] = await textureLoader.loadAsync(hotspot.icon);
        }
        if (hotspot.cena_destino) {
            await preloadTextures(hotspot.cena_destino);
        }
    }
}

// Histórico simples para manter cenas visitadas
function salvarHistoricoCena(cenaId) {
    let historico = JSON.parse(localStorage.getItem('historicoCenas') || '[]');
    if (!historico.includes(cenaId)) {
        historico.push(cenaId);
        localStorage.setItem('historicoCenas', JSON.stringify(historico));
    }
}


// Carrega a cena inicial (id 1), registra cenas e pré-carrega texturas
carregarTodasAsCenas(1).then(async data => {
    if (data) {
        registrarCenasRecursivamente(data);
        await preloadTextures(data);
        loadScene(`panorama${data.id}`);
    }
});

animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    camera.lookAt(new THREE.Vector3(0, 1.6, -1));

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444));

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1;
    controls.maxDistance = 100;
    controls.dampingFactor = 0.2;
    controls.rotateSpeed = -0.3;
    controls.target.set(0, 1.6, -1);
    controls.update();

    raycaster = new THREE.Raycaster();
    tempMatrix = new THREE.Matrix4();

    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStart);
    scene.add(controller2);

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

    // Plano preto para fade
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

    salvarHistoricoCena(data.id);

    if (currentPanoramaMesh) {
        scene.remove(currentPanoramaMesh);
        disposeMesh(currentPanoramaMesh);
        currentPanoramaMesh = null;
    }

    hotspotMeshes.forEach(mesh => disposeMesh(mesh));
    hotspotMeshes = [];

    // Geometria esférica invertida para panorama
    const geometry = new THREE.SphereGeometry(50, 128, 128);
    geometry.scale(-1, 1, 1);

    // Textura da cena carregada no cache
    const texture = textureCache[`panorama${data.id}`];
    if (!texture) {
        console.warn(`Textura não encontrada para a cena: ${sceneName}`);
        return;
    }
    const material = new THREE.MeshBasicMaterial({ map: texture });

    currentPanoramaMesh = new THREE.Mesh(geometry, material);
    currentPanoramaMesh.userData.ignoreRaycast = true;
    scene.add(currentPanoramaMesh);

    // Distribui hotspots em círculo ao redor do usuário
    const totalHotspots = data.hotspots.length;
    const radius = 20;

    data.hotspots.forEach((hotspot, index) => {
        let mat;
        if (hotspot.icon && textureCache[hotspot.icon]) {
            mat = new THREE.SpriteMaterial({ map: textureCache[hotspot.icon], transparent: true, alphaTest: 0.01 });
        } else {
            mat = new THREE.SpriteMaterial({ color: 0xffff00 });
        }

        const sprite = new THREE.Sprite(mat);

        //usa posição real do banco dos hotspots, para mudar a posição
        //deve mudar no banco
        if (
            typeof hotspot.pos_x === 'number' &&
            typeof hotspot.pos_y === 'number' &&
            typeof hotspot.pos_z === 'number'
        ) {
            sprite.position.set(hotspot.pos_x, hotspot.pos_y, hotspot.pos_z);
        } else {
            // fallback: posição em círculo
            const angle = (index / data.hotspots.length) * Math.PI * 2;
            const radius = 20;
            const x = Math.cos(angle) * radius;
            const y = 5;
            const z = Math.sin(angle) * radius;
            sprite.position.set(x, y, z);
        }

        sprite.scale.set(2.5, 2.5, 1);
        sprite.userData.target = hotspot.target;
        hotspotMeshes.push(sprite);
        scene.add(sprite);
        console.log("Hotspot recebido:", hotspot);
        console.log("Hotspot pos:", hotspot.pos_x, hotspot.pos_y, hotspot.pos_z);

    });


    if (!renderer.xr.isPresenting) {
        camera.quaternion.copy(savedCameraQuaternion);
    }
}

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

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    const delta = clock.getDelta();

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

function disposeMesh(mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material?.map) mesh.material.map.dispose();
    if (mesh.material) mesh.material.dispose();
    scene.remove(mesh);
}
