import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { DeviceOrientationCamera } from './controls/deviceOrientationControls.js';
import { carregarTodasAsCenas } from './scenes/scenesFetcher.js';

// ===== CONFIGURAÇÕES VR E DESKTOP =====
const VR_SETTINGS = {
    PANEL_DISTANCE: 1.5,        // distância em metros à frente do usuário
    PANEL_MAX_HEIGHT: 0.9,      // altura máxima física do painel (m)
    PANEL_WIDTH: 2.5,           // largura do painel em metros
    FONT_SIZE_VR: 48,           // tamanho da fonte em pixels para VR
    CANVAS_RESOLUTION: 2048,    // resolução do canvas para VR (alta densidade)
    PANEL_PADDING: 32           // padding maior para VR
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
let textMeshes = []; // Adicionado para rastrear e limpar textos
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

let vrInfoPanelMesh = null;
let vrInfoPanelTexture = null;
let vrInfoPanelCanvas = null;

// Captura erros não tratados
window.addEventListener('unhandledrejection', (event) => {
    console.error('Erro não tratado em promessa:', event.reason, event);
});

// Garanta que as funções existam no escopo global (útil se usar <script type="module">)
window.abrirPainel = function(texto) {
  const painel = document.getElementById('infoPanel');
  const infoText = document.getElementById('infoText');
  const closeBtn = document.getElementById('infoClose');
  if (!painel || !infoText) {
    console.warn('Painel de legenda não encontrado no HTML');
    return;
  }
  // usa textContent para preservar quebras de linha e evitar HTML injection
  infoText.textContent = texto || '';
  painel.style.display = 'block';
  painel.setAttribute('aria-hidden', 'false');
  // foco no botão de fechar para acessibilidade / permitir ESC
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
  // Se seu script for executado antes do DOM, espere DOMContentLoaded
  function init() {
    const painel = document.getElementById('infoPanel');
    const closeBtn = document.getElementById('infoClose');

    if (!painel || !closeBtn) {
      console.warn('Painel ou botão de fechar não encontrados ao inicializar listeners');
      return;
    }

    // Clique no botão X
    closeBtn.addEventListener('click', function (ev) {
      ev.stopPropagation(); // evita propagation para o painel
      fecharPainel();
    });

    // Fecha com ESC
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') fecharPainel();
    });

    // Clique no fundo (fora do conteúdo) fecha o painel
    painel.addEventListener('click', function (ev) {
      // se clicou no próprio painel (background) — fecha.
      if (ev.target === painel) fecharPainel();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

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

    // No botão de ativação
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
                // FORÇA RESET IMEDIATO
                setTimeout(() => {
                    deviceOrientationCamera.resetOrientation();
                }, 100);
            }
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

    // Função para criar laser branco translúcido
    function createLaser() {
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1)
        ]);

        const material = new THREE.LineBasicMaterial({
            color: 0xffffff,     // branco
            transparent: true,
            opacity: 0.8,        // translúcido
            linewidth: 2
        });

        const line = new THREE.Line(geometry, material);
        line.name = 'laser';
        line.scale.z = 10;
        line.visible = true;
        return line;
    }

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

            const laser = createLaser();
            controller.add(laser);
            console.log(`Laser configurado (branco) para controller${index + 1}:`, laser);
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

            // Limpa painel VR se estiver visível
            if (vrInfoPanelMesh && vrInfoPanelMesh.material && vrInfoPanelMesh.material.map) {
                vrInfoPanelMesh.material.map.dispose();
                vrInfoPanelMesh.visible = false;
            }
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

// Função para alinhar sprites/billboards de forma upright (apenas yaw, sem pitch/roll)
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
    } catch (error) {
        console.error('Erro em updateUprightBillboard:', error);
    }
}

// Função para registrar cenas recursivamente
function registrarCenasRecursivamente(cena) {
    try {
        if (!cena || scenesData[`panorama${cena.id}`]) return;
        //console.log(`Registrando cena - ID: ${cena.id}, Imagem: ${cena.image}`);
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

// Função para precarregar texturas
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

// Função para precarregar texturas restantes
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

// Função para salvar histórico de cena
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

// Função para carregar cena
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

        // Limpa todos os hotspots antigos
        hotspotMeshes.forEach(mesh => {
            sceneGroup.remove(mesh);
            disposeMesh(mesh);
        });
        hotspotMeshes = [];

        // Limpa todos os textos antigos
        textMeshes.forEach(mesh => {
            sceneGroup.remove(mesh);
            disposeMesh(mesh);
        });
        textMeshes = [];

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

// Função principal para carregar e processar uma cena no tour virtual em Three.js.
function proceedWithSceneLoading(data, texture, cenaOrigemId, entryQuat = null) {
    try {
        // Limpa hotspots e textos antigos antes de adicionar novos
        hotspotMeshes.forEach(mesh => sceneGroup.remove(mesh));
        textMeshes.forEach(mesh => sceneGroup.remove(mesh));
        hotspotMeshes = [];
        textMeshes = [];

        // Reseta a rotação do grupo da cena para identidade
        sceneGroup.quaternion.set(0, 0, 0, 1);

        // Criação do panorama esférico invertido
        const geometry = new THREE.SphereGeometry(50, 128, 128);
        geometry.scale(-1, 1, 1);
        const material = new THREE.MeshBasicMaterial({ map: texture });
        currentPanoramaMesh = new THREE.Mesh(geometry, material);
        currentPanoramaMesh.userData.ignoreRaycast = true;
        sceneGroup.add(currentPanoramaMesh);

        // Ajuste de altura da câmera
        const desiredEyeHeight = 1.6;
        const heightDiff = desiredEyeHeight - (data.captureHeight || desiredEyeHeight);
        sceneGroup.position.y = -heightDiff;
        currentPanoramaMesh.position.y = 0;
        console.log(`Ajuste de altura aplicado: heightDiff=${heightDiff.toFixed(2)}m`);

        // Hotspot especial para posição da cena
        if (data.pos_x !== null && data.pos_y !== null && data.pos_z !== null) {
            const posicaoHotspot = {
                name: `Olhar para: ${data.descricao}`,
                target: null,
                icon: null,
                pos_x: data.pos_x,
                pos_y: data.pos_y,
                pos_z: data.pos_z,
                entrada_rotacao_y: 0,
                entrada_rotacao_pitch: 0,
                entrada_rotacao_roll: 0,
                isPosicaoCena: true
            };
            data.hotspots.unshift(posicaoHotspot);
        }

        // 🔹 NOVO: Hotspot "Leia-me" para cenas com texto
        if (data.texto) {
            const leiaMeHotspot = {
                name: "Leia-me",
                target: null,
                icon: null, // pode trocar por ícone se quiser
                pos_x: 0,
                pos_y: 1.8,
                pos_z: -3,
                entrada_rotacao_y: 0,
                entrada_rotacao_pitch: 0,
                entrada_rotacao_roll: 0,
                texto: data.texto,
                isLegenda: true,
                tipo: "leiaMe"
            };
            data.hotspots.push(leiaMeHotspot);
        }

        // Configurações globais
        const hotspotSizeWithIcon = 1.5;
        const hotspotSizeWithoutIcon = 0.5;

        // Criação dos hotspots
        data.hotspots.forEach((hotspot, index) => {
            let mesh, mat;

            if (hotspot.isPosicaoCena) {
                return;
            }

            if (hotspot.icon && textureCache[hotspot.icon]) {
                mat = new THREE.SpriteMaterial({ map: textureCache[hotspot.icon], transparent: true });
                mesh = new THREE.Sprite(mat);
                mesh.scale.set(hotspotSizeWithIcon, hotspotSizeWithIcon, hotspotSizeWithIcon);
            } else {
                const circleGeometry = new THREE.CircleGeometry(hotspotSizeWithoutIcon, 32);
                mat = new THREE.MeshBasicMaterial({ color: hotspot.isLegenda ? 0x00ff00 : 0xffff00, side: THREE.DoubleSide });
                mesh = new THREE.Mesh(circleGeometry, mat);
            }

            const hotspotHash = hashString(hotspot.name);
            mesh.userData = {
                target: hotspot.target,
                descricao: hotspot.name,
                entrada_rotacao_y: hotspot.entrada_rotacao_y,
                entrada_rotacao_pitch: hotspot.entrada_rotacao_pitch,
                entrada_rotacao_roll: hotspot.entrada_rotacao_roll,
                gradientColor1: getRgbaFromHash(hotspotHash, 0.7, 0.3, 0.9),
                gradientColor2: getRgbaFromHash(hotspotHash, 0.7, 0.2, 0.9),
                isLegenda: hotspot.isLegenda || false,
                texto: hotspot.texto || null
            };

            if (
                typeof hotspot.pos_x === 'number' &&
                typeof hotspot.pos_y === 'number' &&
                typeof hotspot.pos_z === 'number'
            ) {
                mesh.position.set(hotspot.pos_x, hotspot.pos_y, hotspot.pos_z);
            } else {
                const angle = (index / data.hotspots.length) * Math.PI * 2;
                const radius = 50;
                const x = Math.cos(angle) * radius;
                const z = Math.sin(angle) * radius;
                mesh.position.set(x, 0, z);
            }

            hotspotMeshes.push(mesh);
            sceneGroup.add(mesh);

            // Hotspots com texto (mas não a legenda principal)
            if (hotspot.texto && !hotspot.isLegenda) {
                const textoMesh = criarTextoMesh(hotspot.texto, hotspotHash, renderer.xr.isPresenting);
                textoMesh.position.set(
                    mesh.position.x,
                    mesh.position.y + 0.5,
                    mesh.position.z
                );
                textMeshes.push(textoMesh);
                sceneGroup.add(textoMesh);
            }
        });

        // Rotação inicial
        if (!deviceOrientationCamera.enabled) {
            let yaw = data.entrada_rotacao_y || 0;
            let pitch = renderer.xr.isPresenting ? 0 : (data.entrada_rotacao_pitch || 0);
            let roll = renderer.xr.isPresenting ? 0 : (data.entrada_rotacao_roll || 0);

            if (data.pos_x !== null && data.pos_y !== null && data.pos_z !== null) {
                yaw = calcularRotacaoYDoHotspot(data.pos_x, data.pos_y, data.pos_z);
            }

            if (cenaOrigemId) {
                const hotspotEntrada = data.hotspots.find(h => h.target && h.target.includes(`panorama${cenaOrigemId}`));
                if (hotspotEntrada) {
                    yaw = calcularRotacaoYDoHotspot(hotspotEntrada.pos_x, hotspotEntrada.pos_y, hotspotEntrada.pos_z);
                    pitch = renderer.xr.isPresenting ? 0 : (hotspotEntrada.entrada_rotacao_pitch || 0);
                    roll = renderer.xr.isPresenting ? 0 : (hotspotEntrada.entrada_rotacao_roll || 0);
                    yaw = (yaw % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
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

// ===== FUNÇÃO ADAPTATIVA PARA CRIAR TEXTO - DETECTA VR AUTOMATICAMENTE =====
function criarTextoMesh(texto, hotspotHash, isVR = renderer.xr.isPresenting) {
    const settings = isVR ? VR_SETTINGS : DESKTOP_SETTINGS;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    // Configurações de texto baseadas no modo
    const fontSize = isVR ? settings.FONT_SIZE_VR : settings.FONT_SIZE;
    const font = `${fontSize}px Arial, sans-serif`;
    context.font = font;

    // Mede o comprimento do texto para ajustar o canvas
    const textMetrics = context.measureText(texto);
    let textWidth = textMetrics.width;
    const textHeight = fontSize * 1.2;

    // Para VR, força um tamanho mínimo para legibilidade
    const minWidthVR = settings.CANVAS_RESOLUTION * 0.6;
    if (isVR && textWidth < minWidthVR) {
        textWidth = minWidthVR;
    }

    // Ajusta tamanho do canvas dinamicamente
    const padding = isVR ? settings.PANEL_PADDING : 15;
    canvas.width = Math.max(textWidth + padding * 2, isVR ? settings.CANVAS_RESOLUTION : 512);
    canvas.height = textHeight + padding * 2;

    // Redefine fonte após resize
    context.font = font;
    
    // Fundo com gradiente baseado no hash do hotspot
    const gradientColor1 = getRgbaFromHash(hotspotHash, 0.7, 0.3, isVR ? 0.95 : 0.8);
    const gradientColor2 = getRgbaFromHash(hotspotHash, 0.7, 0.2, isVR ? 0.95 : 0.8);
    
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, gradientColor1);
    gradient.addColorStop(1, gradientColor2);
    
    context.fillStyle = gradient;
    
    // Desenha fundo com bordas arredondadas
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
    
    drawRoundedRect(context, 0, 0, canvas.width, canvas.height, radius);

    // Texto com sombra para melhor legibilidade
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(0, 0, 0, 0.8)';
    context.shadowBlur = isVR ? 6 : 4;
    context.shadowOffsetX = isVR ? 2 : 1;
    context.shadowOffsetY = isVR ? 2 : 1;
    
    // Para VR, quebra de linha se necessário
    if (isVR) {
        const maxWidth = canvas.width - padding * 2;
        const words = texto.split(' ');
        let currentLine = '';
        let yOffset = canvas.height / 2 - (words.length > 5 ? textHeight / 2 : 0);
        
        for (let i = 0; i < words.length; i++) {
            const testLine = currentLine + words[i] + (i < words.length - 1 ? ' ' : '');
            if (context.measureText(testLine).width > maxWidth && currentLine) {
                context.fillText(currentLine, canvas.width / 2, yOffset);
                currentLine = words[i] + ' ';
                yOffset += textHeight * 1.2;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) {
            context.fillText(currentLine, canvas.width / 2, yOffset);
        }
    } else {
        context.fillText(texto, canvas.width / 2, canvas.height / 2);
    }
    
    // Remove sombra
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;

    // Cria textura a partir do canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // Cria material e sprite
    const material = new THREE.SpriteMaterial({ 
        map: texture, 
        transparent: true,
        alphaTest: 0.1
    });
    const sprite = new THREE.Sprite(material);

    // ESCALA CRÍTICA: Ajusta escala baseada no modo VR/Desktop
    if (isVR) {
        // Para VR: escala muito maior (em metros)
        const aspect = canvas.width / canvas.height;
        const vrScale = 1.8; // 1.8 metros de largura base
        sprite.scale.set(aspect * vrScale, vrScale, 1);
    } else {
        // Para desktop: escala normal
        const aspect = canvas.width / canvas.height;
        const baseScale = 0.8;
        sprite.scale.set(aspect * baseScale, baseScale, 1);
    }

    // Adiciona userData para identificação
    sprite.userData = {
        texto: texto,
        hotspotHash: hotspotHash,
        isVR: isVR
    };

    return sprite;
}

// ===== VERSÃO FINAL: PAINEL VR COMPLETO COM TEXTO COMPLETO E "X" =====
function showVrPanelAtHotspot(text, hotspotPosition) {
    try {
        console.log('🎯 === INICIANDO showVrPanelAtHotspot (FINAL) ===');
        console.log('📄 Texto completo recebido:', text.substring(0, 50) + '...');

        // ===== 1. CRIAÇÃO DO CANVAS COM TEXTO COMPLETO =====
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Configurações para VR
        const fontSize = 42; // Tamanho da fonte legível no VR
        const lineHeight = Math.round(fontSize * 1.4); // Espaçamento entre linhas
        const padding = 40; // Padding generoso
        const maxWidth = 1800; // Largura máxima do texto (pixels)
        
        // Mede e quebra o texto em linhas
        ctx.font = `${fontSize}px Arial, sans-serif`;
        const words = text.split(/\s+/);
        const lines = [];
        let currentLine = '';
        
        for (let i = 0; i < words.length; i++) {
            const testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine.trim());
                currentLine = words[i];
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine.trim());
        
        console.log(`📝 Texto quebrado em ${lines.length} linhas`);
        
        // Altura do canvas baseada no número de linhas
        const textHeight = lines.length * lineHeight;
        const canvasHeight = padding * 2 + textHeight + 80; // +80 para o "X" e margem
        canvas.width = maxWidth + padding * 2;
        canvas.height = canvasHeight;
        
        console.log(`🖼️ Canvas final: ${canvas.width}px x ${canvas.height}px`);

        // ===== 2. DESENHO DO FUNDO PRETO COM BORDAS ARREDONDADAS =====
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Fundo preto semi-transparente
        ctx.fillStyle = 'rgba(10, 10, 15, 0.95)';
        const radius = 20;
        
        // Função para retângulo arredondado
        function drawRoundedRect(x, y, width, height, radius) {
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
            
            // Borda sutil branca
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        
        drawRoundedRect(padding/2, padding/2, canvas.width - padding, canvas.height - padding, radius);
        
        // ===== 3. DESENHO DO TEXTO BRANCO =====
        ctx.fillStyle = '#ffffff';
        ctx.font = `${fontSize}px Arial, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 2;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        
        let y = padding;
        lines.forEach((line, index) => {
            // Se a linha for muito longa, quebra novamente
            if (ctx.measureText(line).width > maxWidth) {
                const subWords = line.split(/\s+/);
                let subCurrent = '';
                for (let j = 0; j < subWords.length; j++) {
                    const subTest = subCurrent ? subCurrent + ' ' + subWords[j] : subWords[j];
                    if (ctx.measureText(subTest).width > maxWidth && subCurrent) {
                        ctx.fillText(subCurrent.trim(), padding, y);
                        y += lineHeight;
                        subCurrent = subWords[j];
                    } else {
                        subCurrent = subTest;
                    }
                }
                if (subCurrent) {
                    ctx.fillText(subCurrent.trim(), padding, y);
                    y += lineHeight;
                }
            } else {
                ctx.fillText(line, padding, y);
                y += lineHeight;
            }
        });
        
        // Remove sombra para o "X"
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // ===== 4. DESENHO DO "X" VERMELHO PARA FECHAR =====
        const xSize = fontSize * 1.2;
        ctx.fillStyle = '#ff4444';
        ctx.font = `${Math.round(xSize)}px Arial`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        
        // Desenha o "X" no canto superior direito
        const xX = canvas.width - padding;
        const xY = padding - 5;
        ctx.fillText('✕', xX, xY);
        
        // Adiciona uma área clicável maior (retângulo invisível)
        ctx.fillStyle = 'rgba(255, 68, 68, 0.2)';
        ctx.fillRect(xX - 60, xY - 10, 60, 60);
        
        console.log(`✅ Canvas final criado com ${lines.length} linhas de texto e botão X`);

        // ===== 5. CRIAÇÃO DA TEXTURA E MESH =====
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.needsUpdate = true;

        const aspect = canvas.width / canvas.height;
        const physicalWidth = 2.8; // Largura física em metros
        const physicalHeight = Math.min(1.2, physicalWidth / aspect); // Altura limitada

        if (!vrInfoPanelMesh) {
            console.log('🔨 Criando NOVO vrInfoPanelMesh');
            const geo = new THREE.PlaneGeometry(physicalWidth, physicalHeight);
            const mat = new THREE.MeshBasicMaterial({ 
                map: texture, 
                transparent: true, 
                side: THREE.DoubleSide,
                alphaTest: 0.01
            });
            vrInfoPanelMesh = new THREE.Mesh(geo, mat);
            vrInfoPanelMesh.userData.isVRPanel = true;
            sceneGroup.add(vrInfoPanelMesh);
            console.log(`✅ vrInfoPanelMesh criado: ${physicalWidth}m x ${physicalHeight.toFixed(2)}m`);
        } else {
            console.log('🔄 Atualizando mesh existente');
            if (vrInfoPanelMesh.material.map) {
                vrInfoPanelMesh.material.map.dispose();
            }
            vrInfoPanelMesh.material.map = texture;
            vrInfoPanelMesh.material.map.needsUpdate = true;
            vrInfoPanelMesh.material.needsUpdate = true;
            
            // Ajusta geometria se necessário
            const currentAspect = vrInfoPanelMesh.geometry.parameters.width / vrInfoPanelMesh.geometry.parameters.height;
            if (Math.abs(currentAspect - aspect) > 0.1) {
                vrInfoPanelMesh.geometry.dispose();
                vrInfoPanelMesh.geometry = new THREE.PlaneGeometry(physicalWidth, physicalHeight);
            }
            
            console.log(`✅ Textura atualizada: ${physicalWidth}m x ${physicalHeight.toFixed(2)}m`);
        }

        // ===== 6. POSICIONAMENTO E ORIENTAÇÃO =====
        const targetPosition = hotspotPosition.clone();
        
        // Ajusta altura para nível dos olhos
        if (targetPosition.y < 1.2) {
            targetPosition.y = 1.4;
        } else if (targetPosition.y > 1.8) {
            targetPosition.y = 1.8;
        }
        
        // Mantém distância mínima para legibilidade
        const distanceToCamera = targetPosition.distanceTo(camera.position);
        const minDistance = 1.2;
        if (distanceToCamera < minDistance) {
            const direction = new THREE.Vector3().subVectors(
                camera.position, 
                targetPosition
            ).normalize();
            targetPosition.add(direction.multiplyScalar(minDistance - distanceToCamera));
        }

        vrInfoPanelMesh.position.copy(targetPosition);
        vrInfoPanelMesh.lookAt(camera.position);
        
        // Corrige rotação para upright (sem pitch/roll excessivo)
        const euler = new THREE.Euler().setFromQuaternion(vrInfoPanelMesh.quaternion, 'YXZ');
        euler.x = Math.max(-Math.PI/6, Math.min(Math.PI/6, euler.x)); // Limita pitch
        euler.z = 0; // Sem roll
        vrInfoPanelMesh.quaternion.setFromEuler(euler);

        // ===== 7. ATIVAÇÃO FINAL =====
        vrInfoPanelMesh.visible = true;
        vrInfoPanelMesh.scale.set(1, 1, 1);
        
        console.log('🎯 === PAINEL VR FINALIZADO ===');
        console.log(`✅ PAINEL PRETO VISÍVEL COM TEXTO COMPLETO!`);
        console.log(`📏 Tamanho: ${physicalWidth}m x ${physicalHeight.toFixed(2)}m`);
        console.log(`📍 Posição: (${targetPosition.x.toFixed(2)}, ${targetPosition.y.toFixed(2)}, ${targetPosition.z.toFixed(2)})`);
        console.log(`📐 Distância: ${distanceToCamera.toFixed(2)}m`);
        console.log(`📝 Linhas de texto: ${lines.length}`);
        console.log(`👁️  Visível: ${vrInfoPanelMesh.visible}`);
        
    } catch (error) {
        console.error('❌ ERRO em showVrPanelAtHotspot:', error);
        console.error('Stack trace:', error.stack);
    }
}

// ===== FECHA PAINEL VR APENAS AO CLICAR NO "X" =====
function hideVrPanelIfClicked(hit) {
    if (!vrInfoPanelMesh || !hit || hit.object !== vrInfoPanelMesh) {
        return false;
    }

    // Coordenadas UV do clique no painel
    const uv = hit.uv;
    if (!uv) {
        return false;
    }

    console.log('🖱️ Clique detectado no painel VR - UV:', { x: uv.x, y: uv.y });

    // "X" no canto superior direito (últimos 15% do painel)
    const xButtonSize = 0.15;
    if (uv.x > (1 - xButtonSize) && uv.y > (1 - xButtonSize)) {
        vrInfoPanelMesh.visible = false;
        console.log('✅ Painel VR fechado pelo usuário (clique no X)');
        return true;
    }

    console.log('ℹ️ Clique no painel, mas fora da área do X');
    return false;
}

// ===== CORREÇÃO: onSelectStart COMPORTAMENTO IGUAL AO DESKTOP PARA VR =====
function onSelectStart(event) {
    try {
        const controller = event.target;

        tempMatrix.identity().extractRotation(controller.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyQuaternion(controller.quaternion);

        const interactables = hotspotMeshes.slice();
        if (vrInfoPanelMesh) interactables.push(vrInfoPanelMesh);

        const intersects = raycaster.intersectObjects(interactables, false);

        if (intersects.length > 0) {
            const intersected = intersects[0].object;

            // 🔹 CORREÇÃO: Hotspot de legenda - COMPORTAMENTO IGUAL AO DESKTOP
            if (intersected.userData && intersected.userData.isLegenda && intersected.userData.texto) {
                console.log('🔹 Hotspot "Leia-me" clicado no VR - abrindo legenda');
                
                // NO VR: Mostra o painel de texto igual ao desktop
                showVrPanelAtHotspot(intersected.userData.texto, intersected.position);
                return;
            }

            // 🔹 Verifica se clicou no "X" do painel VR (se existir)
            if (vrInfoPanelMesh && intersected === vrInfoPanelMesh) {
                hideVrPanelIfClicked(intersects[0]);
                return;
            }

            // 🔹 Hotspot de troca de cena
            const target = intersected.userData ? intersected.userData.target : null;
            if (target) {
                console.log('🔹 Hotspot de navegação clicado - trocando cena:', target);
                pendingEntryQuat = camera.quaternion.clone();
                startFade(1, () => {
                    loadScene(target, cenaAtualId, pendingEntryQuat);
                    pendingEntryQuat = null;
                    startFade(-1);
                });
                return;
            }
        }
    } catch (error) {
        console.error('Erro em onSelectStart:', error);
    }
}

// Função para clique do mouse
function onPointerDown(event) {
    try {
        if (renderer.xr.isPresenting) return;

        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(hotspotMeshes, false);

        if (intersects.length > 0) {
            const intersected = intersects[0].object; // 🔹 define intersected
            const target = intersected.userData.target;

            // 🔹 Se for o hotspot "Leia-me", abre painel e NÃO troca cena
            if (intersected.userData.isLegenda && intersected.userData.texto) {
                abrirPainel(intersected.userData.texto);
                return;
            }

            // 🔹 Se tiver target válido, troca de cena
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

// Função para redimensionar janela
function onWindowResize() {
    try {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    } catch (error) {
        console.error('Erro em onWindowResize:', error);
    }
}

// Função para calcular rotação Y de um hotspot
function calcularRotacaoYDoHotspot(pos_x, pos_y, pos_z) {
    try {
        const dir = new THREE.Vector3(pos_x, pos_y, pos_z).normalize();
        return Math.atan2(dir.x, dir.z);
    } catch (error) {
        console.error('Erro em calcularRotacaoYDoHotspot:', error);
        return 0;
    }
}

// Função para aplicar rotação à câmera
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

// Função para atualizar laser do controlador VR
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

// Função para atualizar texto de descrição
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

// Função para iniciar fade
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

// Função de animação
function animate() {
    renderer.setAnimationLoop(render);
}

// Função de renderização
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

        // Atualiza orientação dos hotspots
        hotspotMeshes.forEach(mesh => {
            updateUprightBillboard(mesh, camera);
        });

        // Atualiza orientação dos textos
        textMeshes.forEach(mesh => {
            updateUprightBillboard(mesh, camera);
        });

        // ===== ATUALIZAÇÃO ESPECÍFICA PARA PAINEL VR =====
        if (vrInfoPanelMesh && vrInfoPanelMesh.visible && renderer.xr.isPresenting) {
            // Mantém o painel sempre legível e na distância correta
            const distance = vrInfoPanelMesh.position.distanceTo(camera.position);
            if (distance > VR_SETTINGS.PANEL_DISTANCE * 1.2) {
                // Se muito longe, aproxima suavemente
                const direction = new THREE.Vector3().subVectors(
                    vrInfoPanelMesh.position, 
                    camera.position
                ).normalize();
                vrInfoPanelMesh.position.add(direction.multiplyScalar(
                    (VR_SETTINGS.PANEL_DISTANCE - distance) * 0.02
                ));
            }
            
            // Mantém orientação correta
            updateUprightBillboard(vrInfoPanelMesh, camera);
        }

        if (intersected) {
            atualizarDescricaoTexto(intersected.userData.descricao || '', intersected);
            descricaoSprite.position.copy(intersected.position);
            descricaoSprite.position.y += 3;
            updateUprightBillboard(descricaoSprite, camera);
            descricaoSprite.visible = true;
        } else {
            descricaoSprite.visible = false;
        }

        renderer.render(scene, camera);
    } catch (error) {
        console.error('Erro em render:', error);
    }
}

// Função para liberar memória de meshes
function disposeMesh(mesh) {
    if (!mesh) return;
    
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach(mat => {
                if (mat.map && mat.map !== textureCache) {
                    mat.map.dispose();
                }
                mat.dispose();
            });
        } else {
            if (mesh.material.map && mesh.material.map !== textureCache) {
                mesh.material.map.dispose();
            }
            mesh.material.dispose();
        }
    }
}