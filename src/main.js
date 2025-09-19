import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { DeviceOrientationCamera } from './controls/deviceOrientationControls.js';
import { carregarTodasAsCenas } from './scenes/scenesFetcher.js';

// Variáveis principais
let camera, scene, renderer, controls, deviceOrientationCamera;
let raycaster, tempMatrix;
let hotspotMeshes = [];
let currentPanoramaMesh = null;
let fadePlane, fadeOpacity = 0, fading = false, fadeDirection = 1, fadeCallback = null;
const clock = new THREE.Clock();
const mouse = new THREE.Vector2();
let savedCameraQuaternion = new THREE.Quaternion();
let scenesData = {};
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

// Captura erros não tratados
window.addEventListener('unhandledrejection', (event) => {
    console.error('Erro não tratado em promessa:', event.reason, event);
});

// Funções para geração de cores nas descrições
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
    return `rgba(${Math.floor(color.r * 255)}, ${Math.floor(color.g * 255)}, ${Math.floor(color.b * 255)}, ${alpha})`;
}

init();

carregarTodasAsCenas(1).then(async data => {
    try {
        if (data) {
            console.log(`Cena inicial carregada - ID: ${data.id}, Imagem: ${data.image}`);
            registrarCenasRecursivamente(data);
            await preloadTextures(data);
            await loadScene(`panorama${data.id}`);
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.style.display = 'none';
            }
            preloadRemainingTextures(data);
        } else {
            console.error('Nenhuma cena inicial carregada.');
        }
    } catch (error) {
        console.error('Erro ao inicializar cenas:', error);
    }
}).catch(error => {
    console.error('Erro crítico ao carregar cena inicial:', error);
});

animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

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
    const controlsContainer = document.getElementById('controls-container');
    if (controlsContainer) {
        controlsContainer.appendChild(deviceOrientationButton);
    } else {
        console.warn('Contêiner de controles não encontrado, adicionando ao body');
        document.body.appendChild(deviceOrientationButton);
    }
    deviceOrientationButton.style.display = renderer.xr.isPresenting ? 'none' : 'block';

    deviceOrientationButton.addEventListener('click', () => {
        try {
            if (deviceOrientationCamera.enabled) {
                deviceOrientationCamera.enabled = false;
                deviceOrientationButton.textContent = 'Ativar Orientação por Dispositivo';
                controls.enabled = true;
                controls.update();
                console.log('Device orientation disabled, OrbitControls enabled');
            } else {
                deviceOrientationCamera.enabled = true;
                deviceOrientationCamera.requestPermission();
                deviceOrientationButton.textContent = 'Desativar Orientação por Dispositivo';
                controls.enabled = false;
                console.log('Device orientation enabled, OrbitControls disabled');
            }
        } catch (error) {
            console.error('Erro ao alternar orientação por dispositivo:', error);
        }
    });

    raycaster = new THREE.Raycaster();
    tempMatrix = new THREE.Matrix4();

    const controllerModelFactory = new XRControllerModelFactory();
    const handModelFactory = new XRHandModelFactory();

    controller1 = renderer.xr.getController(0);
    controller2 = renderer.xr.getController(1);
    scene.add(controller1);
    scene.add(controller2);

    function setupController(controller, index) {
        try {
            controller.removeEventListener('selectstart', onSelectStart);
            controller.removeEventListener('select', onSelectStart);

            controller.addEventListener('selectstart', (event) => {
                console.log(`selectstart disparado no controller${index + 1}:`, event);
                onSelectStart(event);
            });
            controller.addEventListener('select', (event) => {
                console.log(`select disparado no controller${index + 1}:`, event);
                onSelectStart(event);
            });

            const existingLaser = controller.getObjectByName('laser');
            if (existingLaser) {
                controller.remove(existingLaser);
                existingLaser.geometry.dispose();
                existingLaser.material.dispose();
            }

            const geometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, -1)
            ]);
            const material = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 1 });
            const line = new THREE.Line(geometry, material);
            line.name = 'laser';
            line.scale.z = 10;
            line.visible = true;
            controller.add(line);
            console.log(`Laser configurado para controller${index + 1}:`, line);
        } catch (error) {
            console.error(`Erro ao configurar controlador ${index + 1}:`, error);
        }
    }

    function setupControllersWithRetry(session) {
        try {
            if (controllerSetupInterval) clearInterval(controllerSetupInterval);
            if (controllerSetupFrame) cancelAnimationFrame(controllerSetupFrame);

            let attempts = 0;
            const maxAttempts = 40;

            function checkControllers() {
                try {
                    if (session.inputSources.length > 0) {
                        console.log('Input sources detectados:', session.inputSources);
                        setupController(controller1, 0);
                        setupController(controller2, 1);
                        if (controllerSetupInterval) clearInterval(controllerSetupInterval);
                        if (controllerSetupFrame) cancelAnimationFrame(controllerSetupFrame);
                        controllerSetupInterval = null;
                        controllerSetupFrame = null;
                    } else {
                        attempts++;
                        console.log(`Tentativa ${attempts}: Nenhum input source detectado ainda`);
                        if (attempts >= maxAttempts) {
                            console.error('Falha ao detectar input sources após 20 segundos.');
                            if (controllerSetupInterval) clearInterval(controllerSetupInterval);
                            if (controllerSetupFrame) cancelAnimationFrame(controllerSetupFrame);
                            controllerSetupInterval = null;
                            controllerSetupFrame = null;
                        } else {
                            controllerSetupFrame = requestAnimationFrame(checkControllers);
                        }
                    }
                } catch (error) {
                    console.error('Erro ao verificar controladores:', error);
                }
            }

            controllerSetupInterval = setInterval(checkControllers, 500);
            checkControllers();
        } catch (error) {
            console.error('Erro ao configurar controladores com retry:', error);
        }
    }

    renderer.xr.addEventListener('sessionstart', async () => {
        try {
            console.log('Sessão WebXR iniciada');
            const session = renderer.xr.getSession();
            setupControllersWithRetry(session);

            let refSpace;
            try {
                refSpace = await session.requestReferenceSpace('local-floor');
                console.log('Usando local-floor sem offset inicial');
            } catch (error) {
                console.warn('local-floor não suportado, fallback para local com offset');
                refSpace = await session.requestReferenceSpace('local');
                const initialOffsetTransform = new XRRigidTransform({ x: 0, y: -1.6, z: 0 });
                refSpace = refSpace.getOffsetReferenceSpace(initialOffsetTransform);
            }

            baseReferenceSpace = refSpace;
            renderer.xr.setReferenceSpace(baseReferenceSpace);

            originalCameraPosition.copy(camera.position);
            camera.position.set(0, 0, 0);

            needsHeightAdjustment = true;

            controls.enabled = false;
            deviceOrientationCamera.enabled = false;
            deviceOrientationButton.style.display = 'none';
            deviceOrientationButton.textContent = 'Ativar Orientação por Dispositivo';
            sceneGroup.quaternion.set(0, 0, 0, 1);
        } catch (error) {
            console.error('Erro ao iniciar sessão WebXR:', error);
        }
    });

    renderer.xr.addEventListener('sessionend', () => {
        try {
            console.log('Sessão WebXR encerrada');
            camera.position.copy(originalCameraPosition);

            controls.enabled = true;
            deviceOrientationCamera.enabled = false;
            deviceOrientationButton.style.display = 'block';
            deviceOrientationButton.textContent = 'Ativar Orientação por Dispositivo';
            camera.quaternion.copy(savedCameraQuaternion);
            [controller1, controller2].forEach((controller, index) => {
                controller.removeEventListener('selectstart', onSelectStart);
                controller.removeEventListener('select', onSelectStart);
                const laser = controller.getObjectByName('laser');
                if (laser) {
                    controller.remove(laser);
                    laser.geometry.dispose();
                    laser.material.dispose();
                }
                console.log(`Controlador ${index + 1} limpo`);
            });
            if (controllerSetupInterval) clearInterval(controllerSetupInterval);
            if (controllerSetupFrame) cancelAnimationFrame(controllerSetupFrame);
            controllerSetupInterval = null;
            controllerSetupFrame = null;
            needsHeightAdjustment = false;
            sceneGroup.quaternion.set(0, 0, 0, 1);
        } catch (error) {
            console.error('Erro ao encerrar sessão WebXR:', error);
        }
    });

    const controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
    scene.add(controllerGrip1);

    const controllerGrip2 = renderer.xr.getControllerGrip(1);
    controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
    scene.add(controllerGrip2);

    const hand1 = renderer.xr.getHand(0);
    hand1.add(handModelFactory.createHandModel(hand1));
    scene.add(hand1);

    const hand2 = renderer.xr.getHand(1);
    hand2.add(handModelFactory.createHandModel(hand2));
    scene.add(hand2);

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

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.font = '36px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.fillText('', canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
    const geometry = new THREE.PlaneGeometry(10, 2.5);
    descricaoSprite = new THREE.Mesh(geometry, material);
    descricaoSprite.visible = false;
    sceneGroup.add(descricaoSprite);

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('mousemove', (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    });
}

// ALTERADO: Simplifica updateUprightBillboard para alinhar diretamente ao eixo Y global
function updateUprightBillboard(mesh, camera) {
    try {
        const worldPos = new THREE.Vector3();
        mesh.getWorldPosition(worldPos);

        // Calcula a direção para a câmera no espaço mundial
        const cameraPos = new THREE.Vector3();
        camera.getWorldPosition(cameraPos);
        const dirToCamera = new THREE.Vector3().subVectors(cameraPos, worldPos).normalize();

        // Projeta a direção no plano XZ para obter apenas o yaw
        const dirXZ = new THREE.Vector3(dirToCamera.x, 0, dirToCamera.z).normalize();

        // Usa lookAt para alinhar o sprite à direção projetada, mantendo Y global
        mesh.lookAt(worldPos.clone().add(dirXZ));

        // Força alinhamento estrito ao eixo Y global
        const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'YXZ');
        euler.x = 0; // Remove pitch
        euler.z = 0; // Remove roll
        mesh.quaternion.setFromEuler(euler);

        // NOVO: Log para depuração
        console.log(`Sprite ${mesh.userData.descricao || 'unknown'} quaternion:`, mesh.quaternion.toArray());
    } catch (error) {
        console.error('Erro em updateUprightBillboard:', error);
    }
}

// ALTERADO: Adiciona log para ID e imagem da cena
function registrarCenasRecursivamente(cena) {
    try {
        if (!cena || scenesData[`panorama${cena.id}`]) return;
        console.log(`Registrando cena - ID: ${cena.id}, Imagem: ${cena.image}`);
        scenesData[`panorama${cena.id}`] = cena;
        for (const hotspot of cena.hotspots || []) {
            if (hotspot.cena_destino && !scenesData[`panorama${hotspot.cena_destino.id}`]) {
                carregarTodasAsCenas(hotspot.cena_destino.id).then(destino => {
                    if (destino) registrarCenasRecursivamente(destino);
                }).catch(error => {
                    console.error(`Erro ao carregar cena destino ${hotspot.cena_destino.id}:`, error);
                });
            }
        }
    } catch (error) {
        console.error('Erro ao registrar cenas recursivamente:', error);
    }
}

async function preloadTextures(cena) {
    try {
        if (!cena) return;

        const promises = [];

        if (!textureCache[`panorama${cena.id}`]) {
            console.log(`Precarregando textura - ID: ${cena.id}, Imagem: ${cena.image}`);
            promises.push(
                textureLoader.loadAsync(cena.image).then(tex => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.minFilter = THREE.LinearFilter;
                    tex.magFilter = THREE.LinearFilter;
                    tex.generateMipmaps = false;
                    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    textureCache[`panorama${cena.id}`] = tex;
                }).catch(error => {
                    console.error(`Erro ao carregar textura para cena ${cena.id}:`, error);
                    throw error;
                })
            );
        }

        for (const hotspot of cena.hotspots || []) {
            if (hotspot.icon && !textureCache[hotspot.icon]) {
                promises.push(
                    textureLoader.loadAsync(hotspot.icon).then(tex => {
                        tex.colorSpace = THREE.SRGBColorSpace;
                        textureCache[hotspot.icon] = tex;
                    }).catch(error => {
                        console.error(`Erro ao carregar textura do hotspot ${hotspot.name}:`, error);
                        throw error;
                    })
                );
            }
        }

        await Promise.all(promises);
    } catch (error) {
        console.error(`Erro em preloadTextures para cena ${cena?.id}:`, error);
        throw error;
    }
}

async function preloadRemainingTextures(initialCena) {
    try {
        const allScenes = Object.values(scenesData);
        const loadedIds = new Set([initialCena.id]);

        const adjacent = initialCena.hotspots
            .map(hotspot => hotspot.cena_destino)
            .filter(dest => dest && !loadedIds.has(dest.id));

        await Promise.all(adjacent.map(dest => {
            loadedIds.add(dest.id);
            return preloadTextures(dest).catch(err => console.error(`Failed to preload ${dest.id}:`, err));
        }));

        const remaining = allScenes.filter(cena => !loadedIds.has(cena.id));
        for (let i = 0; i < remaining.length; i += 4) {
            await Promise.all(
                remaining.slice(i, i + 4).map(cena =>
                    preloadTextures(cena).catch(err => console.error(`Failed to preload ${cena.id}:`, err))
                )
            );
        }
    } catch (error) {
        console.error('Erro em preloadRemainingTextures:', error);
    }
}

function salvarHistoricoCena(cenaId) {
    try {
        let historico = JSON.parse(localStorage.getItem('historicoCenas') || '[]');
        if (!historico.includes(cenaId)) {
            historico.push(cenaId);
            localStorage.setItem('historicoCenas', JSON.stringify(historico));
        }
    } catch (error) {
        console.error('Erro ao salvar histórico de cena:', error);
    }
}

// ALTERADO: Adiciona log para ID e imagem da cena antes de carregar
async function loadScene(sceneName, cenaOrigemId, entryQuat = null) {
    try {
        let data = scenesData[sceneName];
        if (!data) {
            console.log(`Cena "${sceneName}" não encontrada no cache. Carregando agora...`);
            const id = parseInt(sceneName.replace('panorama', ''));
            data = await carregarTodasAsCenas(id);
            if (data) {
                console.log(`Cena carregada do Supabase - ID: ${data.id}, Imagem: ${data.image}`);
                registrarCenasRecursivamente(data);
            } else {
                console.error(`Falha ao carregar cena ${sceneName} do Supabase.`);
                return;
            }
        }
        cenaAtualId = data.id;

        console.log(`Iniciando carregamento da cena - ID: ${data.id}, Imagem: ${data.image}`);

        console.log('Carregando cena:', sceneName);
        console.log('Dados de rotação da cena:', {
            yaw: data.entrada_rotacao_y,
            pitch: data.entrada_rotacao_pitch,
            roll: data.entrada_rotacao_roll
        });

        savedCameraQuaternion.copy(camera.quaternion);
        salvarHistoricoCena(data.id);

        if (currentPanoramaMesh) {
            sceneGroup.remove(currentPanoramaMesh);
            disposeMesh(currentPanoramaMesh);
            currentPanoramaMesh = null;
        }

        hotspotMeshes.forEach(mesh => {
            sceneGroup.remove(mesh);
            disposeMesh(mesh);
        });
        hotspotMeshes = [];

        let texture = textureCache[`panorama${data.id}`];
        if (!texture) {
            console.warn(`Textura não encontrada para ${sceneName}, carregando agora...`);
            blockCameraUpdates = true;
            startFade(1, async () => {
                try {
                    await preloadTextures(data);
                    texture = textureCache[`panorama${data.id}`];
                    proceedWithSceneLoading(data, texture, cenaOrigemId, entryQuat);
                    startFade(-1);
                    blockCameraUpdates = false;
                } catch (error) {
                    console.error(`Erro ao carregar textura para cena ${sceneName}:`, error);
                    startFade(-1);
                    blockCameraUpdates = false;
                }
            });
            return;
        }

        proceedWithSceneLoading(data, texture, cenaOrigemId, entryQuat);
    } catch (error) {
        console.error(`Erro em loadScene(${sceneName}):`, error);
    }
}

// ALTERADO: Ignora pitch e roll em VR
function proceedWithSceneLoading(data, texture, cenaOrigemId, entryQuat = null) {
    try {
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
        console.log(`Ajuste de altura aplicado: heightDiff=${heightDiff.toFixed(2)}m`);

        currentPanoramaMesh.position.y = 0;

        data.hotspots.forEach((hotspot, index) => {
            let mat;
            if (hotspot.icon && textureCache[hotspot.icon]) {
                mat = new THREE.MeshBasicMaterial({
                    map: textureCache[hotspot.icon],
                    transparent: true,
                    alphaTest: 0.01,
                    side: THREE.DoubleSide
                });
            } else {
                mat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide });
            }

            const geometry = new THREE.PlaneGeometry(1.5, 1.5);
            const mesh = new THREE.Mesh(geometry, mat);

            const hotspotHash = hashString(hotspot.name);
            mesh.userData = {
                target: hotspot.target,
                descricao: hotspot.name,
                entrada_rotacao_y: hotspot.entrada_rotacao_y,
                entrada_rotacao_pitch: hotspot.entrada_rotacao_pitch,
                entrada_rotacao_roll: hotspot.entrada_rotacao_roll,
                gradientColor1: getRgbaFromHash(hotspotHash, 0.7, 0.3, 0.9),
                gradientColor2: getRgbaFromHash(hotspotHash, 0.7, 0.2, 0.9)
            };

            if (
                typeof hotspot.pos_x === 'number' &&
                typeof hotspot.pos_y === 'number' &&
                typeof hotspot.pos_z === 'number'
            ) {
                mesh.position.set(hotspot.pos_x, hotspot.pos_y, hotspot.pos_z);
                console.log(`Hotspot ${hotspot.name}: pos_x=${hotspot.pos_x.toFixed(3)}, pos_y=${hotspot.pos_y.toFixed(3)}, pos_z=${hotspot.pos_z.toFixed(3)}`);
            } else {
                const angle = (index / data.hotspots.length) * Math.PI * 2;
                const x = Math.cos(angle) * 50;
                const y = 0;
                const z = Math.sin(angle) * 50;
                mesh.position.set(x, y, z);
                console.warn(`Hotspot ${hotspot.name} sem posição válida, usando padrão: x=${x.toFixed(3)}, y=${y.toFixed(3)}, z=${z.toFixed(3)}`);
            }

            hotspotMeshes.push(mesh);
            sceneGroup.add(mesh);
        });

        if (!deviceOrientationCamera.enabled) {
            let yaw = data.entrada_rotacao_y || 0;
            let pitch = renderer.xr.isPresenting ? 0 : (data.entrada_rotacao_pitch || 0); // NOVO: Zera pitch em VR
            let roll = renderer.xr.isPresenting ? 0 : (data.entrada_rotacao_roll || 0);  // NOVO: Zera roll em VR

            if (cenaOrigemId) {
                const hotspotEntrada = data.hotspots.find(hotspot => {
                    const destinoId = hotspot.cena_destino?.id;
                    console.log(`Verificando hotspot: destinoId=${destinoId}, cenaOrigemId=${cenaOrigemId}`);
                    return destinoId === Number(cenaOrigemId);
                });

                if (hotspotEntrada) {
                    yaw = calcularRotacaoYDoHotspot(hotspotEntrada.pos_x, hotspotEntrada.pos_y, hotspotEntrada.pos_z);
                    pitch = renderer.xr.isPresenting ? 0 : (hotspotEntrada.entrada_rotacao_pitch || 0); // NOVO: Zera pitch em VR
                    roll = renderer.xr.isPresenting ? 0 : (hotspotEntrada.entrada_rotacao_roll || 0);  // NOVO: Zera roll em VR
                    yaw = (yaw % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
                    console.log(`Rotação do hotspot de entrada: yaw=${yaw.toFixed(3)}, pitch=${pitch.toFixed(3)}, roll=${roll.toFixed(3)} rad`);
                } else {
                    console.warn(`Hotspot de entrada para cena ${cenaOrigemId} não encontrado. Usando rotação da cena.`);
                }
            }

            aplicarRotacaoCamera(yaw, pitch, roll, entryQuat);
        } else {
            deviceOrientationCamera.resetOrientation();
            sceneGroup.quaternion.set(0, 0, 0, 1);
        }

        console.log('Cena carregada:', `panorama${data.id}`);
        preloadRemainingTextures(data);
    } catch (error) {
        console.error('Erro ao processar cena:', error);
    }
}

function startFade(direction, callback) {
    try {
        fadeDirection = direction;
        fadeCallback = callback;
        fading = true;
        blockCameraUpdates = direction === 1;
    } catch (error) {
        console.error('Erro em startFade:', error);
    }
}

function onSelectStart(event) {
    try {
        console.log('onSelectStart chamado:', event.target, event);
        const controller = event.target;
        tempMatrix.identity().extractRotation(controller.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
        const intersects = raycaster.intersectObjects(hotspotMeshes, false);
        console.log('Interseções VR:', intersects);
        if (intersects.length > 0) {
            const target = intersects[0].object.userData.target;
            console.log('Hotspot selecionado:', target);
            if (target) {
                pendingEntryQuat = camera.quaternion.clone();
                startFade(1, () => {
                    loadScene(target, cenaAtualId, pendingEntryQuat);
                    pendingEntryQuat = null;
                    startFade(-1);
                });
            }
        } else {
            console.log('Nenhum hotspot intersectado pelo controlador');
        }
    } catch (error) {
        console.error('Erro em onSelectStart:', error);
    }
}

function onPointerDown(event) {
    try {
        if (renderer.xr.isPresenting) return;

        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(hotspotMeshes, false);

        if (intersects.length > 0) {
            const target = intersects[0].object.userData.target;
            if (target) {
                pendingEntryQuat = camera.quaternion.clone();
                startFade(1, () => {
                    loadScene(target, cenaAtualId, pendingEntryQuat);
                    pendingEntryQuat = null;
                    startFade(-1);
                });
            }
        }
    } catch (error) {
        console.error('Erro em onPointerDown:', error);
    }
}

function onWindowResize() {
    try {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    } catch (error) {
        console.error('Erro em onWindowResize:', error);
    }
}

function calcularRotacaoYDoHotspot(pos_x, pos_y, pos_z) {
    try {
        const dir = new THREE.Vector3(pos_x, pos_y, pos_z).normalize();
        return Math.atan2(dir.x, dir.z);
    } catch (error) {
        console.error('Erro em calcularRotacaoYDoHotspot:', error);
        return 0;
    }
}

// ALTERADO: Garante que apenas yaw seja aplicado ao sceneGroup em VR
function aplicarRotacaoCamera(yaw, pitch = 0, roll = 0, entryQuat = null) {
    try {
        let effectivePitch = pitch;
        let effectiveRoll = roll;

        if (renderer.xr.isPresenting) {
            effectivePitch = 0; // Zera pitch em VR
            effectiveRoll = 0;  // Zera roll em VR
        }

        const euler = new THREE.Euler(effectivePitch, yaw, effectiveRoll, 'YXZ');
        const quaternion = new THREE.Quaternion().setFromEuler(euler).normalize();
        savedCameraQuaternion.copy(quaternion);

        if (renderer.xr.isPresenting) {
            let qHeadset = camera.quaternion.clone();
            if (entryQuat) {
                qHeadset.copy(entryQuat);
            }
            // Extrai apenas o yaw do headset
            const eulerHeadset = new THREE.Euler().setFromQuaternion(qHeadset, 'YXZ');
            eulerHeadset.x = 0; // Remove pitch
            eulerHeadset.z = 0; // Remove roll
            const qHeadsetYawOnly = new THREE.Quaternion().setFromEuler(eulerHeadset);
            
            const qDesiredInv = quaternion.clone().invert();
            sceneGroup.quaternion.copy(qHeadsetYawOnly.multiply(qDesiredInv));

            // NOVO: Log para depuração
            console.log(`sceneGroup quaternion após aplicar rotação:`, sceneGroup.quaternion.toArray());
        } else {
            camera.quaternion.copy(quaternion);
            if (controls.enabled) {
                controls.target.set(0, 0, -0.001)
                    .applyQuaternion(quaternion)
                    .add(camera.position);
                controls.update();
            }
        }

        console.log(
            `>> Rotação aplicada: yaw=${yaw.toFixed(3)}, pitch=${effectivePitch.toFixed(3)}, roll=${effectiveRoll.toFixed(3)}` +
            (entryQuat ? ` (usando entryQuat salvo)` : '')
        );
    } catch (error) {
        console.error('Erro em aplicarRotacaoCamera:', error);
    }
}

function updateLaser(controller) {
    try {
        const laser = controller.getObjectByName('laser');
        if (!laser) {
            console.warn('Laser não encontrado para controlador:', controller);
            return;
        }

        tempMatrix.identity().extractRotation(controller.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        const intersects = raycaster.intersectObjects(hotspotMeshes, false);
        laser.visible = true;
        if (intersects.length > 0) {
            laser.scale.z = intersects[0].distance;
            console.log('Laser intersectou hotspot:', intersects[0].object.userData);
        } else {
            laser.scale.z = 10;
        }
    } catch (error) {
        console.error('Erro em updateLaser:', error);
    }
}

function atualizarDescricaoTexto(texto, intersected) {
    try {
        const canvas = descricaoSprite.material.map.image;
        const ctx = canvas.getContext('2d');

        const width = 512;
        const height = 128;
        canvas.width = width;
        canvas.height = height;

        ctx.clearRect(0, 0, width, height);

        const fontSize = 32;
        const paddingX = 20;
        const paddingY = 15;
        const radius = 18;

        ctx.font = `${fontSize}px Arial, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'center';

        const maxWidth = width * 0.9;
        const words = texto.split(' ');
        const lines = [];
        let currentLine = '';

        for (let i = 0; i < words.length; i++) {
            const testLine = currentLine + words[i] + ' ';
            if (ctx.measureText(testLine).width > maxWidth && currentLine !== '') {
                lines.push(currentLine.trim());
                currentLine = words[i] + ' ';
            } else {
                currentLine = testLine;
            }
        }
        lines.push(currentLine.trim());

        let maxLineWidth = 0;
        lines.forEach(line => {
            const lineWidth = ctx.measureText(line).width;
            if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
        });

        const lineHeight = fontSize * 1.3;
        const textHeight = lines.length * lineHeight;
        const boxWidth = maxLineWidth + paddingX * 2;
        const boxHeight = textHeight + paddingY * 2;
        const boxX = (width - boxWidth) / 2;
        const boxY = (height - boxHeight) / 2;

        const gradient = ctx.createLinearGradient(0, boxY, 0, boxY + boxHeight);
        gradient.addColorStop(0, intersected.userData.gradientColor1 || 'rgba(30,30,30,0.9)');
        gradient.addColorStop(1, intersected.userData.gradientColor2 || 'rgba(10,10,10,0.9)');

        ctx.fillStyle = gradient;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(boxX + radius, boxY);
        ctx.lineTo(boxX + boxWidth - radius, boxY);
        ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
        ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
        ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
        ctx.lineTo(boxX + radius, boxY + boxHeight);
        ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
        ctx.lineTo(boxX, boxY + radius);
        ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'white';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], width / 2, boxY + paddingY + i * lineHeight);
        }

        ctx.shadowColor = 'transparent';
        descricaoSprite.material.map.needsUpdate = true;
    } catch (error) {
        console.error('Erro em atualizarDescricaoTexto:', error);
    }
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render(time, frame) {
    try {
        const delta = clock.getDelta();

        if (renderer.xr.isPresenting && frame && needsHeightAdjustment) {
            needsHeightAdjustment = false;
            const referenceSpace = renderer.xr.getReferenceSpace();
            const viewerPose = frame.getViewerPose(referenceSpace);
            if (viewerPose) {
                const h = viewerPose.transform.position.y;
                console.log(`Altura reportada pelo headset: ${h.toFixed(2)}m. Ajustando para 1.6m...`);
                const deltaY = h - 1.6;
                const offsetTransform = new XRRigidTransform({ x: 0, y: deltaY, z: 0 });
                const newReferenceSpace = referenceSpace.getOffsetReferenceSpace(offsetTransform);
                renderer.xr.setReferenceSpace(newReferenceSpace);
                baseReferenceSpace = newReferenceSpace;
                console.log(`Ajuste aplicado: offset y=${deltaY.toFixed(2)}. Nova altura efetiva: 1.6m`);
            } else {
                console.warn('Não foi possível obter viewerPose na primeira frame.');
            }
        }

        if (!blockCameraUpdates) {
            if (!renderer.xr.isPresenting && deviceOrientationCamera.enabled) {
                deviceOrientationCamera.update();
                console.log('DeviceOrientationCamera updating');
            } else if (!renderer.xr.isPresenting && controls.enabled) {
                controls.update();
            }
        }

        if (fading) {
            fadeOpacity += fadeDirection * delta * 0.6;
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

        let intersected = null;

        if (renderer.xr.isPresenting) {
            const session = renderer.xr.getSession();
            if (session) {
                session.inputSources.forEach((inputSource, index) => {
                    if (inputSource.gamepad && inputSource.gamepad.buttons[0]?.pressed) {
                        console.log(`Gatilho pressionado no controlador ${index}`);
                        onSelectStart({ target: index === 0 ? controller1 : controller2 });
                    }
                });
            }

            [controller1, controller2].forEach((controller, index) => {
                updateLaser(controller);
                tempMatrix.identity().extractRotation(controller.matrixWorld);
                raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
                raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
                const intersects = raycaster.intersectObjects(hotspotMeshes, false);
                console.log(`Raycaster VR - Interseções controlador ${index + 1}:`, intersects);
                if (intersects.length > 0 && !intersected) {
                    intersected = intersects[0].object;
                }
            });
        } else {
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(hotspotMeshes, false);
            if (intersects.length > 0) {
                intersected = intersects[0].object;
            }
        }

        hotspotMeshes.forEach(mesh => {
            updateUprightBillboard(mesh, camera);
        });

        if (intersected) {
            atualizarDescricaoTexto(intersected.userData.descricao || '', intersected);
            descricaoSprite.position.copy(intersected.position);
            descricaoSprite.position.y += 3;
            updateUprightBillboard(descricaoSprite, camera);
            descricaoSprite.visible = true;
        } else {
            descricaoSprite.visible = false;
        }

        console.log('sceneGroup quaternion:', sceneGroup.quaternion.toArray());

        renderer.render(scene, camera);
    } catch (error) {
        console.error('Erro em render:', error);
    }
}

function disposeMesh(mesh) {
    try {
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
            if (mesh.material.map) mesh.material.map.dispose();
            mesh.material.dispose();
        }
    } catch (error) {
        console.error('Erro em disposeMesh:', error);
    }
}