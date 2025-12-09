import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { DeviceOrientationCamera } from './controls/deviceOrientationControls.js';
import { scenesData } from './scenes/scenesData.js'; 

// configurações visuais e de layout
const VR_SETTINGS = {
    PANEL_DISTANCE: 1.5,
    PANEL_MAX_HEIGHT: 0.9,
    PANEL_WIDTH: 2.5,
    FONT_SIZE_VR: 48,
    CANVAS_RESOLUTION: 2048,
    PANEL_PADDING: 32
};

const DESKTOP_SETTINGS = {
    FONT_SIZE: 28,
    CANVAS_WIDTH: 512,
    CANVAS_HEIGHT: 128
};

// Variáveis principais
let camera, scene, renderer, controls, deviceOrientationCamera;
let raycaster, tempMatrix;
let hotspotMeshes = [];
let textMeshes = [];
let currentPanoramaMesh = null;
let fadePlane, fadeOpacity = 0, fading = false, fadeDirection = 1, fadeCallback = null;
const clock = new THREE.Clock();
const mouse = new THREE.Vector2();
let savedCameraQuaternion = new THREE.Quaternion();
let controller1, controller2;
let descricaoSprite = null;
let cenaAtualId;
const textureCache = {};
const textureLoader = new THREE.TextureLoader();
let controllerSetupInterval = null;
let controllerSetupFrame = null;
let deviceOrientationButton = null;
let baseReferenceSpace = null;
let sceneGroup;
let needsHeightAdjustment = false;
let originalCameraPosition = new THREE.Vector3(0, 0, 0);
let pendingEntryQuat = null;
let blockCameraUpdates = false;

let vrInfoPanelMesh = null;
const metadataCache = {};
const ImageLoader = new THREE.ImageLoader();
// Captura erros não tratados
window.addEventListener('unhandledrejection', (event) => {
    console.error('Erro não tratado em promessa:', event.reason, event);
});

// configurações do painel do texto
window.abrirPainel = function(texto) {
    const painel = document.getElementById('infoPanel');
    const infoText = document.getElementById('infoText');
    const closeBtn = document.getElementById('infoClose');
    if (!painel || !infoText) {
        console.warn('Painel de legenda não encontrado no HTML');
        return;
    }
    infoText.textContent = texto || '';
    painel.style.display = 'block';
    painel.setAttribute('aria-hidden', 'false');
    if (closeBtn) closeBtn.focus();
};

window.fecharPainel = function() {
    const painel = document.getElementById('infoPanel');
    if (!painel) return;
    painel.style.display = 'none';
    painel.setAttribute('aria-hidden', 'true');
};

// Conecta listeners depois que DOM estiver pronto
(function attachInfoPanelListeners() {
    function init() {
        const painel = document.getElementById('infoPanel');
        const closeBtn = document.getElementById('infoClose');

        if (!painel || !closeBtn) {
            console.warn('Painel ou botão de fechar não encontrados ao inicializar listeners');
            return;
        }

        closeBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            fecharPainel();
        });

        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') fecharPainel();
        });

        painel.addEventListener('click', function (ev) {
            if (ev.target === painel) fecharPainel();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

// Funções para geração de cores
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

function getRgbaFromHash(hash, saturation = 0.7, lightness = 0.3, alpha = 0.9) {
    const hue = (hash % 360) / 360;
    const color = new THREE.Color().setHSL(hue, saturation, lightness);
    return `rgba(${Math.floor(color.r * 255)}, ${Math.floor(color.g * 255)}, ${Math.floor(color.b * 255)}, ${alpha})`; // CORREÇÃO: Usar r, g, b para a cor
}


function getCenaById(id) {
    const raw = scenesData[id];
    if (!raw) {
        console.warn(`Cena ${id} não encontrada em scenesData`);
        return null;
    }

    const hotspots = (raw.hotspots || []).map(h => ({
        name: h.name,
        target: `panorama${h.target}`,
        icon: h.icon,
        position: h.position, // Manter o objeto position
        pos_x: h.position.x,
        pos_y: h.position.y,
        pos_z: h.position.z,
        entrada_rotacao_y: 0,
        entrada_rotacao_pitch: 0,
        entrada_rotacao_roll: 0,
        texto: h.texto || null,
        isLegenda: false
    }));

    return {
        id: id,
        image: raw.image,
        initialYaw: raw.initialYaw || 0, // Manter o initialYaw em graus
        entrada_rotacao_y: THREE.MathUtils.degToRad(raw.initialYaw || 0),
        entrada_rotacao_pitch: 0,
        entrada_rotacao_roll: 0,
        hotspots: hotspots,
        captureHeight: 1.6,
        pos_x: null,
        pos_y: null,
        pos_z: null,
        texto: raw.texto || null
    };
}


init();
animate();

// Carrega cena inicial
const initialData = getCenaById(1);
if (initialData) {
    (async () => {
        try {
            await preloadTextures(initialData);
            await loadScene(`panorama${initialData.id}`);
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) loadingScreen.style.display = 'none';
            preloadRemainingTextures(initialData);
        } catch (error) {
            console.error('Erro ao inicializar cena:', error);
        }
    })();
} else {
    console.error('Cena inicial (1) não encontrada em scenesData.js');
}

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    
    // ===============================================
    // 🎨 CORREÇÃO PARA GATILHOS PRETOS: ILUMINAÇÃO
    // AJUSTE: Aumentar intensidade da luz ambiente e direcional
    // ===============================================
    
    // 1. Luz de Ambiente (suave, para preencher sombras e dar cor base)
    // Aumentar a intensidade para garantir que MeshBasicMaterial seja visível.
    const ambientLight = new THREE.AmbientLight(0xffffff, 5.0); // Cor branca, Intensidade 5.0 (alto para VR/panoramas)
    scene.add(ambientLight);

    // 2. Luz Direcional (para dar contraste e realce)
    // Aumentar a intensidade.
    const directionalLight = new THREE.DirectionalLight(0xffffff, 8.0); // Luz branca, Intensidade 8.0 (alto para VR/panoramas)
    directionalLight.position.set(0, 10, 5); // Posição
    scene.add(directionalLight);
    
    // ===============================================

    sceneGroup = new THREE.Group();
    scene.add(sceneGroup);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(new THREE.Vector3(0, 0, -0.001));

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer, {
        optionalFeatures: ['local-floor', 'local', 'hand-tracking']
    }));

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minDistance = 0.001;
    controls.maxDistance = 0.001;
    controls.dampingFactor = 0.2;
    controls.rotateSpeed = -0.3;
    controls.target.set(0, 0, -0.001);
    controls.update();

    deviceOrientationCamera = new DeviceOrientationCamera(camera, renderer);
    deviceOrientationCamera.enabled = false;
    camera.controls = controls;

    deviceOrientationButton = document.createElement('button');
    deviceOrientationButton.textContent = 'Ativar Orientação por Dispositivo';
    deviceOrientationButton.className = 'control-button';
    const controlsContainer = document.getElementById('controls-container') || document.body;
    controlsContainer.appendChild(deviceOrientationButton);
    deviceOrientationButton.style.display = renderer.xr.isPresenting ? 'none' : 'block';

    deviceOrientationButton.addEventListener('click', async () => {
        if (deviceOrientationCamera.enabled) {
            deviceOrientationCamera.enabled = false;
            controls.enabled = true;
            deviceOrientationButton.textContent = 'Ativar Giroscópio';
        } else {
            const granted = await deviceOrientationCamera.requestPermission();
            if (granted) {
                controls.enabled = false;
                deviceOrientationButton.textContent = 'Desativar Giroscópio';
                setTimeout(() => deviceOrientationCamera.resetOrientation(), 100);
            }
        }
    });

    raycaster = new THREE.Raycaster();
    tempMatrix = new THREE.Matrix4();

    const controllerModelFactory = new XRControllerModelFactory();
    const handModelFactory = new XRHandModelFactory();

    controller1 = renderer.xr.getController(0);
    controller2 = renderer.xr.getController(1);
    scene.add(controller1, controller2);

    function createLaser() {
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1)
        ]);
        const material = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8,
            linewidth: 2
        });
        const line = new THREE.Line(geometry, material);
        line.name = 'laser';
        line.scale.z = 10;
        return line;
    }

    function setupController(controller, index) {
        controller.removeEventListener('selectstart', onSelectStart);
        controller.removeEventListener('select', onSelectStart);
        controller.addEventListener('selectstart', onSelectStart);
        controller.addEventListener('select', onSelectStart);

        const oldLaser = controller.getObjectByName('laser');
        if (oldLaser) {
            controller.remove(oldLaser);
            oldLaser.geometry.dispose();
            oldLaser.material.dispose();
        }
        controller.add(createLaser());
    }

    function setupControllersWithRetry(session) {
        if (controllerSetupInterval) clearInterval(controllerSetupInterval);
        if (controllerSetupFrame) cancelAnimationFrame(controllerSetupFrame);

        let attempts = 0;
        const maxAttempts = 40;

        function check() {
            if (session.inputSources.length > 0) {
                setupController(controller1, 0);
                setupController(controller2, 1);
                clearInterval(controllerSetupInterval);
                controllerSetupInterval = null;
            } else if (++attempts < maxAttempts) {
                controllerSetupFrame = requestAnimationFrame(check);
            }
        }

        controllerSetupInterval = setInterval(check, 500);
        check();
    }

    renderer.xr.addEventListener('sessionstart', async () => {
        const session = renderer.xr.getSession();
        setupControllersWithRetry(session);

        let refSpace;
        try {
            refSpace = await session.requestReferenceSpace('local-floor');
        } catch {
            refSpace = await session.requestReferenceSpace('local');
            refSpace = refSpace.getOffsetReferenceSpace(new XRRigidTransform({ y: -1.6 }));
        }
        baseReferenceSpace = refSpace;
        renderer.xr.setReferenceSpace(refSpace);

        originalCameraPosition.copy(camera.position);
        camera.position.set(0, 0, 0);
        needsHeightAdjustment = true;

        controls.enabled = false;
        deviceOrientationCamera.enabled = false;
        deviceOrientationButton.style.display = 'none';
        sceneGroup.quaternion.set(0, 0, 0, 1);
    });

    renderer.xr.addEventListener('sessionend', () => {
        camera.position.copy(originalCameraPosition);
        controls.enabled = true;
        deviceOrientationCamera.enabled = false;
        deviceOrientationButton.style.display = 'block';
        deviceOrientationButton.textContent = 'Ativar Giroscópio';
        camera.quaternion.copy(savedCameraQuaternion);

        [controller1, controller2].forEach(c => {
            c.removeEventListener('selectstart', onSelectStart);
            c.removeEventListener('select', onSelectStart);
            const laser = c.getObjectByName('laser');
            if (laser) {
                c.remove(laser);
                laser.geometry.dispose();
                laser.material.dispose();
            }
        });

        if (controllerSetupInterval) clearInterval(controllerSetupInterval);
        if (controllerSetupFrame) cancelAnimationFrame(controllerSetupFrame);
        controllerSetupInterval = controllerSetupFrame = null;

        needsHeightAdjustment = false;
        sceneGroup.quaternion.set(0, 0, 0, 1);

        if (vrInfoPanelMesh?.material?.map) {
            vrInfoPanelMesh.material.map.dispose();
            vrInfoPanelMesh.visible = false;
        }
    });

    const grip1 = renderer.xr.getControllerGrip(0);
    grip1.add(controllerModelFactory.createControllerModel(grip1));
    scene.add(grip1);
    
    const grip2 = renderer.xr.getControllerGrip(1);
    grip2.add(controllerModelFactory.createControllerModel(grip2));
    scene.add(grip2); 

    const hand1 = renderer.xr.getHand(0);
    hand1.add(handModelFactory.createHandModel(hand1));
    scene.add(hand1);

    const hand2 = renderer.xr.getHand(1);
    hand2.add(handModelFactory.createHandModel(hand2));
    scene.add(hand2);

    const fadeGeo = new THREE.PlaneGeometry(2, 2);
    const fadeMat = new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0,
        depthTest: false, depthWrite: false
    });
    fadePlane = new THREE.Mesh(fadeGeo, fadeMat);
    fadePlane.renderOrder = 999;
    fadePlane.frustumCulled = false;
    scene.add(fadePlane);

    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = '36px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.fillText('', 256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(10, 2.5);
    descricaoSprite = new THREE.Mesh(geo, mat);
    descricaoSprite.visible = false;
    sceneGroup.add(descricaoSprite);

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('mousemove', (e) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
}

function updateUprightBillboard(mesh, camera) {
    const pos = mesh.getWorldPosition(new THREE.Vector3());
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(camPos, pos).normalize();
    const dirXZ = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    mesh.lookAt(pos.clone().add(dirXZ));
    const e = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'YXZ');
    e.x = e.z = 0;
    mesh.quaternion.setFromEuler(e);
}

function calcularRotacaoYDoHotspot(x, y, z) {
    return Math.atan2(x, z);
}

function aplicarRotacaoCamera(yaw, pitch = 0, roll = 0, entryQuat = null) {
    const e = new THREE.Euler(pitch, yaw, roll, 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(e).normalize();
    savedCameraQuaternion.copy(q);
    if (renderer.xr.isPresenting) {
        let qHead = entryQuat ? entryQuat.clone() : camera.quaternion.clone();
        const eHead = new THREE.Euler().setFromQuaternion(qHead, 'YXZ');
        eHead.x = eHead.z = 0;
        const qYaw = new THREE.Quaternion().setFromEuler(eHead);
        sceneGroup.quaternion.copy(qYaw.multiply(q.invert()));
    } else {
        camera.quaternion.copy(q);
        if (controls.enabled) {
            controls.target.set(0, 0, -0.001).applyQuaternion(q).add(camera.position);
            controls.update();
        }
    }
}

function updateLaser(controller) {
    const laser = controller.getObjectByName('laser');
    if (!laser) return;
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    const hits = raycaster.intersectObjects(hotspotMeshes, false);
    laser.scale.z = hits.length > 0 ? hits[0].distance : 10;
}

function atualizarDescricaoTexto(texto, obj) {
    const canvas = descricaoSprite.material.map.image;
    const ctx = canvas.getContext('2d');
    const w = 512, h = 128;
    canvas.width = w; canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    const fontSize = 32, padX = 20, padY = 15, radius = 18;
    ctx.font = `${fontSize}px Arial`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';

    const lines = [];
    let line = '';
    const words = texto.split(' ');
    for (const word of words) {
        const test = line + word + ' ';
        if (ctx.measureText(test).width > w * 0.9 && line) {
            lines.push(line.trim());
            line = word + ' ';
        } else line = test;
    }
    if (line) lines.push(line.trim());

    const lineH = fontSize * 1.3;
    const textH = lines.length * lineH;
    const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2;
    const boxH = textH + padY * 2;
    const boxX = (w - boxW) / 2;
    const boxY = (h - boxH) / 2;

    const grad = ctx.createLinearGradient(0, boxY, 0, boxY + boxH);
    grad.addColorStop(0, obj.userData.gradientColor1 || 'rgba(30,30,30,0.9)');
    grad.addColorStop(1, obj.userData.gradientColor2 || 'rgba(10,10,10,0.9)');
    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(boxX + radius, boxY);
    ctx.lineTo(boxX + boxW - radius, boxY);
    ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + radius);
    ctx.lineTo(boxX + boxW, boxY + boxH - radius);
    ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - radius, boxY + boxH);
    ctx.lineTo(boxX + radius, boxY + boxH);
    ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - radius);
    ctx.lineTo(boxX, boxY + radius);
    ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 2;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, boxY + padY + i * lineH));
    ctx.shadowColor = 'transparent';

    descricaoSprite.material.map.needsUpdate = true;
}

function startFade(dir, cb) {
    fadeDirection = dir;
    fadeCallback = cb;
    fading = true;
    blockCameraUpdates = dir === 1;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function disposeMesh(mesh) {
    if (!mesh) return;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => {
            m.map?.dispose();
            m.dispose();
        });
    } else {
        mesh.material?.map?.dispose();
        mesh.material?.dispose();
    }
}

async function getPanoramaOrientation(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Fetch failed');
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const dataView = new DataView(arrayBuffer);
        
        if (dataView.getUint16(0, false) !== 0xFFD8) {
            return { yaw: undefined, pitch: undefined, roll: undefined, poseYaw: undefined, posePitch: undefined, poseRoll: undefined, exifOrientation: 1 };
        }
        
        let offset = 2;
        let xmpString = null;
        let exifOrientation = 1;
        
        while (offset < dataView.byteLength - 4) {
            const marker = dataView.getUint16(offset, false);
            
            if (marker !== 0xFFE1) {
                offset += 2;
                const length = dataView.getUint16(offset, false);
                offset += length;
                continue;
            }
            
            offset += 2;
            const segmentLength = dataView.getUint16(offset, false);
            offset += 2;
            
            const headerLength = Math.min(29, segmentLength - 2);
            const header = getStringFromDataView(dataView, offset, headerLength);
            
            if (header === 'http://ns.adobe.com/xap/1.0/\0') {
                xmpString = getStringFromDataView(dataView, offset + 29, segmentLength - 31);
            } else if (header.startsWith('Exif\0\0')) {
                try {
                    let exifOffset = offset + 6;
                    const littleEndian = dataView.getUint16(exifOffset, false) === 0x4949;
                    exifOffset += 2;
                    
                    const tiffOffset = exifOffset;
                    const ifdOffset = dataView.getUint32(exifOffset, littleEndian);
                    exifOffset = tiffOffset + ifdOffset;
                    
                    const numEntries = dataView.getUint16(exifOffset, littleEndian);
                    exifOffset += 2;
                    
                    for (let i = 0; i < numEntries; i++) {
                        const entryOffset = exifOffset + i * 12;
                        const tag = dataView.getUint16(entryOffset + 0, littleEndian);
                        if (tag === 0x0112) {
                            exifOrientation = dataView.getUint16(entryOffset + 8, littleEndian);
                            break;
                        }
                    }
                } catch (e) {
                    console.warn('Erro ao ler EXIF:', e);
                }
            }
            
            offset += segmentLength - 2;
        }
        
        let yaw = undefined, pitch = undefined, roll = undefined;
        let poseYaw = undefined, posePitch = undefined, poseRoll = undefined;
        
        if (xmpString) {
            const headingMatch = xmpString.match(/GPano:InitialViewHeadingDegrees="([\d.-]+)"/);
            if (headingMatch) yaw = parseFloat(headingMatch[1]);
            
            const pitchMatch = xmpString.match(/GPano:InitialViewPitchDegrees="([\d.-]+)"/);
            if (pitchMatch) pitch = parseFloat(pitchMatch[1]);
            
            const rollMatch = xmpString.match(/GPano:InitialViewRollDegrees="([\d.-]+)"/);
            if (rollMatch) roll = parseFloat(rollMatch[1]);
            
            const poseHeadingMatch = xmpString.match(/GPano:PoseHeadingDegrees="([\d.-]+)"/);
            if (poseHeadingMatch) poseYaw = parseFloat(poseHeadingMatch[1]);
            
            const posePitchMatch = xmpString.match(/GPano:PosePitchDegrees="([\d.-]+)"/);
            if (posePitchMatch) posePitch = parseFloat(posePitchMatch[1]);
            
            const poseRollMatch = xmpString.match(/GPano:PoseRollDegrees="([\d.-]+)"/);
            if (poseRollMatch) poseRoll = parseFloat(poseRollMatch[1]);
        }
        
        return { yaw, pitch, roll, poseYaw, posePitch, poseRoll, exifOrientation };
    } catch (e) {
        console.error('Error parsing metadata:', e);
        return { yaw: undefined, pitch: undefined, roll: undefined, poseYaw: undefined, posePitch: undefined, poseRoll: undefined, exifOrientation: 1 };
    }
}

function getStringFromDataView(dv, offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
        str += String.fromCharCode(dv.getUint8(offset + i));
    }
    return str;
}

async function loadCorrectedTexture(url) {
    const meta = await getPanoramaOrientation(url);
    const image = await ImageLoader.loadAsync(url);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    let width = image.width;
    let height = image.height;
    let rotate = 0;
    let flipX = 1;
    let flipY = 1;
    switch (meta.exifOrientation) {
        case 2:
            flipX = -1;
            break;
        case 3:
            rotate = 180;
            break;
        case 4:
            rotate = 180;
            flipY = -1;
            break;
        case 5:
            rotate = 90;
            flipY = -1;
            [width, height] = [height, width];
            break;
        case 6:
            rotate = 90;
            [width, height] = [height, width];
            break;
        case 7:
            rotate = 90;
            flipX = -1;
            [width, height] = [height, width];
            break;
        case 8:
            rotate = -90;
            [width, height] = [height, width];
            break;
    }
    let needsCanvas = rotate !== 0 || flipX !== 1 || flipY !== 1 || width !== image.width || height !== image.height;
    let texture;
    if (needsCanvas) {
        canvas.width = width;
        canvas.height = height;
        context.save();
        context.translate(width / 2, height / 2);
        context.rotate(THREE.MathUtils.degToRad(rotate));
        context.scale(flipX, flipY);
        context.drawImage(image, -image.width / 2, -image.height / 2);
        context.restore();
        texture = new THREE.CanvasTexture(canvas);
    } else {
        texture = new THREE.Texture(image);
        texture.image = image; // Certifica-se de que a imagem original é usada
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    
    // Adicionar metadados para garantir o InitialView:
    if (meta.yaw !== undefined || meta.pitch !== undefined || meta.roll !== undefined) {
        metadataCache[url] = { ...metadataCache[url], ...meta };
    }
    
    return { texture, meta };
}
// precarregar texturas
async function preloadTextures(cena) {
    if (!cena || !renderer) return;
    const promises = [];
    const cenaKey = `panorama${cena.id}`;
    if (!textureCache[cenaKey]) {
        promises.push(
            loadCorrectedTexture(cena.image).then(({ texture, meta }) => {
                textureCache[cenaKey] = texture;
                metadataCache[cenaKey] = meta;
            }).catch(err => {
                console.error(`Erro ao carregar panorama ${cena.id}:`, err);
                throw err;
            })
        );
    }
    for (const hotspot of cena.hotspots || []) {
        if (hotspot.icon && !textureCache[hotspot.icon]) {
            promises.push(
                textureLoader.loadAsync(hotspot.icon).then(tex => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    textureCache[hotspot.icon] = tex;
                }).catch(err => {
                    //console.warn(`Ícone não encontrado: ${hotspot.icon}. Usando fallback.`, err);
                })
            );
        }
    }
    await Promise.all(promises);
}

async function preloadRemainingTextures(initialCena) {
    const allIds = Object.keys(scenesData).map(k => parseInt(k.replace('panorama', '')));
    const loaded = new Set([initialCena.id]);

    const adjacent = initialCena.hotspots
        .map(h => parseInt(h.target.replace('panorama', ''), 10))
        .filter(id => !isNaN(id) && !loaded.has(id));

    for (const id of adjacent) {
        loaded.add(id);
        const cena = getCenaById(id);
        if (cena) await preloadTextures(cena).catch(() => {});
    }

    const remaining = allIds.filter(id => !loaded.has(id));
    for (let i = 0; i < remaining.length; i += 4) {
        await Promise.all(
            remaining.slice(i, i + 4).map(id => {
                const cena = getCenaById(id);
                return cena ? preloadTextures(cena).catch(() => {}) : Promise.resolve();
            })
        );
    }
}

function salvarHistoricoCena(cenaId) {
    try {
        let historico = JSON.parse(localStorage.getItem('historicoCenas') || '[]');
        if (!historico.includes(cenaId)) {
            historico.push(cenaId);
            localStorage.setItem('historicoCenas', JSON.stringify(historico));
        }
    } catch (err) {
        console.error('Erro ao salvar histórico:', err);
    }
}

// ===== CARREGAR CENA =====
async function loadScene(sceneName, cenaOrigemId, entryQuat = null) {
    const id = parseInt(sceneName.replace('panorama', ''), 10);
    const data = getCenaById(id);

    if (!data) {
        console.error(`Cena ${id} não encontrada`);
        return;
    }

    cenaAtualId = data.id;
    savedCameraQuaternion.copy(camera.quaternion);
    salvarHistoricoCena(data.id);
    console.log(cenaAtualId);

    if (currentPanoramaMesh) {
        sceneGroup.remove(currentPanoramaMesh);
        disposeMesh(currentPanoramaMesh);
        currentPanoramaMesh = null;
    }

    hotspotMeshes.forEach(m => { sceneGroup.remove(m); disposeMesh(m); });
    textMeshes.forEach(m => { sceneGroup.remove(m); disposeMesh(m); });
    hotspotMeshes = [];
    textMeshes = [];
    
    // Certifica-se de que o painel VR esteja escondido ao carregar nova cena
    if (vrInfoPanelMesh) vrInfoPanelMesh.visible = false;


    let texture = textureCache[`panorama${data.id}`];
    if (!texture) {
        blockCameraUpdates = true;
        startFade(1, async () => {
            await preloadTextures(data);
            texture = textureCache[`panorama${data.id}`];
            proceedWithSceneLoading(data, texture, cenaOrigemId, entryQuat);
            startFade(-1);
            blockCameraUpdates = false;
        });
        return;
    }

    proceedWithSceneLoading(data, texture, cenaOrigemId, entryQuat);
}

// ===== PROCESSAR CENA =====
function proceedWithSceneLoading(data, texture, cenaOrigemId, entryQuat = null) {
    hotspotMeshes.forEach(m => sceneGroup.remove(m));
    textMeshes.forEach(m => sceneGroup.remove(m));
    hotspotMeshes = [];
    textMeshes = [];
    sceneGroup.quaternion.set(0, 0, 0, 1);

    const geometry = new THREE.SphereGeometry(50, 128, 128);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    currentPanoramaMesh = new THREE.Mesh(geometry, material);
    currentPanoramaMesh.userData.ignoreRaycast = true;
    sceneGroup.add(currentPanoramaMesh);

    const desiredEyeHeight = 1.6;
    const heightDiff = desiredEyeHeight - (data.captureHeight || desiredEyeHeight);
    sceneGroup.position.y = -heightDiff;

    // ---------- METADADOS DA PANORAMA ----------
    const cenaKey = `panorama${data.id}`;
    const meta = metadataCache[cenaKey] || {
        yaw: undefined, pitch: undefined, roll: undefined,
        poseYaw: undefined, posePitch: undefined, poseRoll: undefined
    };

    // Quaternion para corrigir posição dos hotspots
    let q_pos_adjust = new THREE.Quaternion();
    let sphereRotationQuat = new THREE.Quaternion(); // Para rotacionar a esfera

    if (meta.poseYaw !== undefined || meta.posePitch !== undefined || meta.poseRoll !== undefined) {
        const poseYawRad   = meta.poseYaw   !== undefined ? THREE.MathUtils.degToRad(meta.poseYaw)   : 0;
        const posePitchRad = meta.posePitch !== undefined ? THREE.MathUtils.degToRad(meta.posePitch) : 0;
        const poseRollRad  = meta.poseRoll  !== undefined ? THREE.MathUtils.degToRad(meta.poseRoll)  : 0;

        // Pose em ordem YXZ para Three.js
        const poseEuler = new THREE.Euler(-posePitchRad, poseYawRad, -poseRollRad, 'YXZ');
        const poseQuat  = new THREE.Quaternion().setFromEuler(poseEuler);

        // Rotação da esfera (invertida)
        sphereRotationQuat.copy(poseQuat.clone().invert());
        currentPanoramaMesh.quaternion.copy(sphereRotationQuat);

        // Ajuste para hotspots
        q_pos_adjust.copy(poseQuat);
    } else {
        currentPanoramaMesh.quaternion.identity();
    }

    // Sobrescreve yaw/pitch/roll inicial se a imagem tiver InitialView
    let baseYaw = data.entrada_rotacao_y;
    let basePitch = data.entrada_rotacao_pitch;
    let baseRoll = data.entrada_rotacao_roll;
    
    if (meta.yaw !== undefined)   baseYaw   = THREE.MathUtils.degToRad(meta.yaw);
    if (meta.pitch !== undefined) basePitch = THREE.MathUtils.degToRad(meta.pitch);
    if (meta.roll !== undefined)  baseRoll  = THREE.MathUtils.degToRad(meta.roll);

    // ---------- YAW DE ENTRADA QUANDO VEM DE OUTRA CENA ----------
    let entryYawOverride = null;
    if (cenaOrigemId) {
        const entrada = data.hotspots.find(h => h.target === `panorama${cenaOrigemId}`);
        if (entrada) {
            const pos = new THREE.Vector3(entrada.pos_x, entrada.pos_y, entrada.pos_z)
                .applyQuaternion(q_pos_adjust);
            entryYawOverride = Math.atan2(pos.x, pos.z);
        }
    }

    // ---------- CRIA HOTSPOTS ----------
    if (data.texto) {
        const leiaMe = {
            name: "Leia-me",
            target: null,
            icon: null,
            position: { x: 0, y: 1.8, z: -3 }, // Usar a estrutura original do scenesData para manter consistência
            pos_x: 0,
            pos_y: 1.8,
            pos_z: -3,
            texto: data.texto,
            isLegenda: true
        };
        data.hotspots.push(leiaMe);
    }

    data.hotspots.forEach((hotspot) => {
        if (hotspot.isPosicaoCena) return;

        // Identifica se é hotspot informativo (tem texto mas não tem target)
        const isHotspotInformativo = !hotspot.target && hotspot.texto;

        let mesh, mat;
        if (hotspot.icon && textureCache[hotspot.icon]) {
            mat = new THREE.SpriteMaterial({ map: textureCache[hotspot.icon], transparent: true });
            mesh = new THREE.Sprite(mat);
            mesh.scale.set(1.5, 1.5, 1.5);
        } else {
            const geo = new THREE.CircleGeometry(0.5, 32);
            
            // Navegação (target) é Verde, Informativo (sem target) é Amarelo
            // Usando MeshLambertMaterial em vez de MeshBasicMaterial para interagir com a nova iluminação
            const color = hotspot.target ? 0x00ff00 : 0xffff00;
            
            // **MUDANÇA AQUI**: Usar MeshPhongMaterial ou MeshStandardMaterial para melhor interação com a luz
            // MeshBasicMaterial também funciona se a luz ambiente for alta o suficiente (como ajustado em init)
            // Mantendo MeshBasicMaterial, mas assegurando que as luzes estão ativas.
            mat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide });
            mesh = new THREE.Mesh(geo, mat);
        }

        const hash = hashString(hotspot.name);
        mesh.userData = {
            target: hotspot.target,
            descricao: hotspot.name, // Texto curto para o sprite de hover
            entrada_rotacao_y: hotspot.entrada_rotacao_y,
            entrada_rotacao_pitch: hotspot.entrada_rotacao_pitch,
            entrada_rotacao_roll: hotspot.entrada_rotacao_roll,
            gradientColor1: getRgbaFromHash(hash, 0.7, 0.3, 0.9),
            gradientColor2: getRgbaFromHash(hash, 0.7, 0.2, 0.9),
            isLegenda: hotspot.isLegenda || false,
            texto: hotspot.texto || null, // Texto completo para o painel de clique
            isHotspotInformativo: isHotspotInformativo
        };

        const pos = new THREE.Vector3(hotspot.pos_x, hotspot.pos_y, hotspot.pos_z)
            .applyQuaternion(q_pos_adjust);
        mesh.position.copy(pos);
        hotspotMeshes.push(mesh);
        sceneGroup.add(mesh);
        
        // **NENHUM TEXTMESH FLUTUANTE CRIADO AQUI**
    });

    // ---------- APLICA ROTAÇÃO INICIAL DA CÂMERA ----------
    if (!deviceOrientationCamera.enabled) {
        let finalYaw = entryYawOverride !== null ? entryYawOverride : baseYaw;
        
        const baseEuler = new THREE.Euler(basePitch, finalYaw, baseRoll, 'YXZ');
        const baseQuat = new THREE.Quaternion().setFromEuler(baseEuler);
        const finalQuat = baseQuat.clone().multiply(q_pos_adjust.clone().invert());
        
        savedCameraQuaternion.copy(finalQuat);
        
        if (renderer.xr.isPresenting) {
            let qHead = entryQuat ? entryQuat.clone() : camera.quaternion.clone();
            const eHead = new THREE.Euler().setFromQuaternion(qHead, 'YXZ');
            eHead.x = eHead.z = 0;
            const qYaw = new THREE.Quaternion().setFromEuler(eHead);
            sceneGroup.quaternion.copy(qYaw.multiply(finalQuat.invert()));
        } else {
            camera.quaternion.copy(finalQuat);
            if (controls.enabled) {
                controls.target.set(0, 0, -0.001).applyQuaternion(finalQuat).add(camera.position);
                controls.update();
            }
        }
    } else {
        deviceOrientationCamera.resetOrientation();
        sceneGroup.quaternion.set(0, 0, 0, 1);
    }

    preloadRemainingTextures(data);
}

// ===== INTERAÇÃO VR: onSelectStart =====
function onSelectStart(event) {
    const controller = event.target;
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyQuaternion(controller.quaternion);

    const interactables = [...hotspotMeshes];
    if (vrInfoPanelMesh) interactables.push(vrInfoPanelMesh);

    const intersects = raycaster.intersectObjects(interactables, false);
    if (intersects.length === 0) return;

    const hit = intersects[0].object;

    // 1. Verifica se clicou no painel VR para fechar
    if (vrInfoPanelMesh && hit === vrInfoPanelMesh) {
        if (hideVrPanelIfClicked(intersects[0])) return;
        
        // Se não clicou no 'X', o clique no painel deve ser ignorado para não navegar
        return; 
    }

    // Se o painel VR estiver visível (mas não foi o alvo do clique), ignoramos outros cliques
    if (vrInfoPanelMesh && vrInfoPanelMesh.visible) return;


    // 2. Prioriza mostrar texto se houver (para informativos, legenda ou navegáveis com info extra)
    if (hit.userData.texto) {
        showVrPanelAtHotspot(hit.userData.texto, hit.position);
        return; // Retorna: texto foi mostrado, não navega
    }

    // 3. Hotspot de navegação normal (tem target, mas NÃO tem texto)
    const target = hit.userData.target;
    if (target) {
        pendingEntryQuat = camera.quaternion.clone();
        startFade(1, () => {
            loadScene(target, cenaAtualId, pendingEntryQuat);
            pendingEntryQuat = null;
            startFade(-1);
        });
    }
}

// ===== INTERAÇÃO DESKTOP: onPointerDown =====
function onPointerDown(event) {
    if (renderer.xr.isPresenting) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(hotspotMeshes, false);

    if (intersects.length === 0) return;

    const hit = intersects[0].object;

    // 1. Prioriza mostrar texto se houver (para informativos, legenda ou navegáveis com info extra)
    if (hit.userData.texto) {
        abrirPainel(hit.userData.texto);
        return; // Retorna: texto foi mostrado, não navega
    }

    // 2. Hotspot de navegação normal (tem target, mas NÃO tem texto)
    const target = hit.userData.target;
    if (target) {
        pendingEntryQuat = camera.quaternion.clone();
        startFade(1, () => {
            loadScene(target, cenaAtualId, pendingEntryQuat);
            pendingEntryQuat = null;
            startFade(-1);
        });
    }
}

// ===== RENDER LOOP =====
function animate() {
    renderer.setAnimationLoop(render);
}

function render(time, frame) {
    const delta = clock.getDelta();

    if (renderer.xr.isPresenting && frame && needsHeightAdjustment) {
        needsHeightAdjustment = false;
        const pose = frame.getViewerPose(baseReferenceSpace);
        if (pose) {
            const h = pose.transform.position.y;
            const offset = new XRRigidTransform({ y: h - 1.6 });
            const newSpace = baseReferenceSpace.getOffsetReferenceSpace(offset);
            renderer.xr.setReferenceSpace(newSpace);
            baseReferenceSpace = newSpace;
        }
    }

    if (!blockCameraUpdates) {
        if (!renderer.xr.isPresenting && deviceOrientationCamera.enabled) {
            deviceOrientationCamera.update();
        } else if (!renderer.xr.isPresenting && controls.enabled) {
            controls.update();
        }
    }

    if (fading) {
        fadeOpacity += fadeDirection * delta * 0.6;
        fadeOpacity = THREE.MathUtils.clamp(fadeOpacity, 0, 1);
        fadePlane.material.opacity = fadeOpacity;
        if ((fadeDirection > 0 && fadeOpacity >= 1) || (fadeDirection < 0 && fadeOpacity <= 0)) {
            fading = false;
            fadeCallback?.();
            fadeCallback = null;
        }
    }

    fadePlane.position.copy(camera.position);
    fadePlane.quaternion.copy(camera.quaternion);
    fadePlane.translateZ(-0.5);

    let intersected = null;

    if (renderer.xr.isPresenting) {
        const session = renderer.xr.getSession();
        session?.inputSources.forEach((src, i) => {
            if (src.gamepad?.buttons[0]?.pressed) {
                // Seleção de botão é tratada em onSelectStart
            }
        });

        [controller1, controller2].forEach(c => {
            updateLaser(c);
            tempMatrix.identity().extractRotation(c.matrixWorld);
            raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
            raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
            const hits = raycaster.intersectObjects(hotspotMeshes, false);
            if (hits.length > 0 && !intersected) intersected = hits[0].object;
        });
    } else {
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(hotspotMeshes, false);
        if (hits.length > 0) intersected = hits[0].object;
    }

    hotspotMeshes.forEach(m => updateUprightBillboard(m, camera));
    textMeshes.forEach(m => updateUprightBillboard(m, camera));

    if (vrInfoPanelMesh?.visible && renderer.xr.isPresenting) {
        // Lógica para manter o painel VR visível e virado para o usuário
        const dist = vrInfoPanelMesh.position.distanceTo(camera.position);
        if (dist > VR_SETTINGS.PANEL_DISTANCE * 1.2) {
            const dir = new THREE.Vector3().subVectors(vrInfoPanelMesh.position, camera.position).normalize();
            vrInfoPanelMesh.position.add(dir.multiplyScalar((VR_SETTINGS.PANEL_DISTANCE - dist) * 0.02));
        }
        updateUprightBillboard(vrInfoPanelMesh, camera);
    }

    if (intersected) {
        // Mostra a descrição flutuante (hotspot.descricao - o nome) no hover/gaze
        if (intersected.userData.descricao) {
            // Usa o hash do próprio hotspot (baseado no nome/descricao)
            const hash = hashString(intersected.userData.descricao); 
            atualizarDescricaoTexto(intersected.userData.descricao, intersected);
            
            // **CORREÇÃO AQUI**: Aumentar o offset vertical (de 1.2 para 1.8) para levantar o texto
            descricaoSprite.position.copy(intersected.position).y += 1.8;
            
            updateUprightBillboard(descricaoSprite, camera);
            descricaoSprite.visible = true;
        } else {
             descricaoSprite.visible = false;
        }
    } else {
        descricaoSprite.visible = false;
    }

    renderer.render(scene, camera);
}

// ===== FUNÇÕES DE PAINEL VR E TEXTO =====

function createVrInfoPanelContent(texto, hotspotHash) {
    // Reusa a lógica de criação de texto para gerar o painel grande para VR
    const panelMesh = criarTextoMesh(texto, hotspotHash, true); 
    const canvas = panelMesh.material.map.image;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Desenha o botão de fechar (X) no canto superior direito
    const buttonSize = VR_SETTINGS.FONT_SIZE_VR * 1.2;
    const padding = VR_SETTINGS.PANEL_PADDING;
    const buttonX = w - buttonSize - padding;
    const buttonY = padding;

    // Fundo do botão (vermelho)
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.arc(buttonX + buttonSize / 2, buttonY + buttonSize / 2, buttonSize / 2, 0, Math.PI * 2);
    ctx.fill();

    // Texto do botão (X)
    ctx.fillStyle = 'white';
    ctx.font = `${buttonSize * 0.8}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('X', buttonX + buttonSize / 2, buttonY + buttonSize / 2 + (buttonSize * 0.05));

    panelMesh.material.map.needsUpdate = true;
    
    // Escala o painel para um tamanho padrão no mundo (ex: 2.5 metros de largura)
    const targetWidth = VR_SETTINGS.PANEL_WIDTH; 
    const aspect = w / h;
    panelMesh.scale.set(targetWidth, targetWidth / aspect, 1);
    
    // Armazena as dimensões do botão no userData para hideVrPanelIfClicked
    panelMesh.userData.closeButton = {
        x: buttonX,
        y: buttonY,
        size: buttonSize,
        canvasWidth: w,
        canvasHeight: h
    };

    return panelMesh;
}

function showVrPanelAtHotspot(texto, hotspotPosition) {
    if (!renderer.xr.isPresenting) return;

    // 1. Limpa o painel anterior
    if (vrInfoPanelMesh) {
        disposeMesh(vrInfoPanelMesh);
        // CORREÇÃO: Remove da cena principal (scene) para não herdar a rotação do sceneGroup
        scene.remove(vrInfoPanelMesh); 
        vrInfoPanelMesh = null;
    }

    // 2. Cria o novo painel
    // Gera um hash simples baseado no texto para manter a cor
    const textHash = hashString(texto.substring(0, Math.min(texto.length, 50))); 
    const panel = createVrInfoPanelContent(texto, textHash); 

    if (!panel) return;
    
    vrInfoPanelMesh = panel;
    vrInfoPanelMesh.renderOrder = 998; 
    // CORREÇÃO: Adiciona à cena principal (scene)
    scene.add(vrInfoPanelMesh); 

    // 3. Posiciona o painel na frente da câmera
    // Calcula a direção de visualização atual da câmera
    const cameraDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const cameraPosition = camera.position.clone();
    
    // Coloca a uma distância fixa da câmera
    const panelDistance = VR_SETTINGS.PANEL_DISTANCE;
    vrInfoPanelMesh.position.copy(cameraPosition).add(cameraDirection.multiplyScalar(panelDistance));
    
    // Altura: no nível do olho (cameraPosition.y)
    vrInfoPanelMesh.position.y = cameraPosition.y; 

    updateUprightBillboard(vrInfoPanelMesh, camera);
    vrInfoPanelMesh.visible = true;
}


function criarTextoMesh(texto, hotspotHash, isVR = renderer.xr.isPresenting) {
    const settings = isVR ? VR_SETTINGS : DESKTOP_SETTINGS;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    const fontSize = isVR ? settings.FONT_SIZE_VR : settings.FONT_SIZE;
    const font = `${fontSize}px Arial, sans-serif`;
    context.font = font;

    // Simulação inicial para calcular o tamanho
    context.font = font; // Reaplicar fonte
    let lines = [];
    let currentLine = '';
    const maxWidth = isVR ? (settings.CANVAS_RESOLUTION - settings.PANEL_PADDING * 2) : (settings.CANVAS_WIDTH * 0.8);
    
    texto.split(' ').forEach(word => {
        const testLine = currentLine + word + ' ';
        if (context.measureText(testLine).width > maxWidth && currentLine) {
            lines.push(currentLine.trim());
            currentLine = word + ' ';
        } else {
            currentLine = testLine;
        }
    });
    if (currentLine) lines.push(currentLine.trim());
    
    const lineH = fontSize * 1.2;
    const padding = isVR ? settings.PANEL_PADDING : 15;
    
    let textWidth = Math.max(...lines.map(l => context.measureText(l).width), 100);
    let textHeight = lines.length * lineH;
    
    // Define o tamanho do canvas com base no conteúdo (garantindo altura mínima para o botão 'X' no VR)
    let requiredHeight = textHeight + padding * 2;
    if (isVR) {
         // Altura mínima para o botão de fechar e o padding (FONT_SIZE_VR * 1.2 + 2 * PANEL_PADDING)
        const minVrHeight = VR_SETTINGS.FONT_SIZE_VR * 1.2 + VR_SETTINGS.PANEL_PADDING * 2;
        requiredHeight = Math.max(requiredHeight, minVrHeight);
    }
    
    canvas.width = isVR ? settings.CANVAS_RESOLUTION : Math.min(settings.CANVAS_WIDTH, textWidth + padding * 2);
    canvas.height = isVR ? Math.min(requiredHeight, settings.CANVAS_RESOLUTION * (settings.PANEL_MAX_HEIGHT / settings.PANEL_WIDTH)) : Math.min(settings.CANVAS_HEIGHT, requiredHeight);
    
    // Redefine maxWidth e textWidth se o canvas.width foi ajustado
    if (isVR) {
         // Recalcula a largura de texto máxima para quebra de linha se o canvas.width for o mesmo que CANVAS_RESOLUTION
    }

    // Desenha o conteúdo real
    const finalWidth = canvas.width;
    const finalHeight = canvas.height;
    
    context.clearRect(0, 0, finalWidth, finalHeight);
    context.font = font;

    const gradientColor1 = getRgbaFromHash(hotspotHash, 0.7, 0.3, isVR ? 0.95 : 0.8);
    const gradientColor2 = getRgbaFromHash(hotspotHash, 0.7, 0.2, isVR ? 0.95 : 0.8);

    const gradient = context.createLinearGradient(0, 0, 0, finalHeight);
    gradient.addColorStop(0, gradientColor1);
    gradient.addColorStop(1, gradientColor2);

    context.fillStyle = gradient;

    const radius = isVR ? 24 : 8;
    function drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
    }

    drawRoundedRect(context, 0, 0, finalWidth, finalHeight, radius);

    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'top'; // Mudado para 'top' para melhor controle das linhas
    context.shadowColor = 'rgba(0, 0, 0, 0.8)';
    context.shadowBlur = isVR ? 6 : 4;
    context.shadowOffsetX = isVR ? 2 : 1;
    context.shadowOffsetY = isVR ? 2 : 1;

    // Desenha as linhas de texto centralizadas
    lines.forEach((line, index) => {
        const yPos = padding + index * lineH;
        context.fillText(line, finalWidth / 2, yPos);
    });
    
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide }); // Usar MeshBasicMaterial/PlaneGeometry no VR para melhor hitbox
    const geometry = new THREE.PlaneGeometry(1, 1); 
    const sprite = new THREE.Mesh(geometry, material); // Mudança para Mesh/PlaneGeometry
    
    // A escala para VR é aplicada em createVrInfoPanelContent
    if (!isVR) {
        // Usa sprite para desktop/mobile flutuante
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.1 });
        const sprite = new THREE.Sprite(spriteMaterial);
        const aspect = finalWidth / finalHeight;
        const baseScale = 0.8;
        sprite.scale.set(aspect * baseScale, baseScale, 1);
        sprite.userData = { texto, hotspotHash, isVR };
        return sprite;
    }

    sprite.userData = { texto, hotspotHash, isVR };
    return sprite;
}


function hideVrPanelIfClicked(hit) {
    if (!vrInfoPanelMesh || !hit || hit.object !== vrInfoPanelMesh || !hit.uv || !vrInfoPanelMesh.userData.closeButton) return false;
    
    const uv = hit.uv;
    const buttonData = vrInfoPanelMesh.userData.closeButton;
    
    const panelCanvasWidth = buttonData.canvasWidth; // 2048 (VR_SETTINGS.CANVAS_RESOLUTION)
    const panelCanvasHeight = buttonData.canvasHeight; // Altura gerada
    
    const closeButtonX = buttonData.x; // Coordenada X em pixels
    const closeButtonY = buttonData.y; // Coordenada Y em pixels
    const closeButtonSize = buttonData.size; // Tamanho em pixels

    // Converte a coordenada UV (0 a 1) para a coordenada de pixel na textura (canvas)
    const pixelX = uv.x * panelCanvasWidth;
    // O canvas.fillText começa no topo (Y=0) e cresce para baixo. 
    // Como o THREE.js inverte o Y do UV em materiais com mapeamento de textura padrão:
    const pixelY = (1 - uv.y) * panelCanvasHeight; 

    // O botão 'X' está no canto superior direito do canvas
    // Condição de acerto no eixo X: pixelX está entre X e (X + Size)
    const hitX = pixelX >= closeButtonX && pixelX <= (closeButtonX + closeButtonSize);

    // Condição de acerto no eixo Y: pixelY está entre Y e (Y + Size)
    const hitY = pixelY >= closeButtonY && pixelY <= (closeButtonY + closeButtonSize);

    if (hitX && hitY) {
        vrInfoPanelMesh.visible = false;
        disposeMesh(vrInfoPanelMesh);
        // CORREÇÃO: Remove da cena principal (scene)
        scene.remove(vrInfoPanelMesh);
        vrInfoPanelMesh = null;
        return true;
    }
    return false;
}