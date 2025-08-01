import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { carregarTodasAsCenas } from './scenes/scenesFetcher.js';

// Variáveis principais
let camera, scene, renderer, controls;
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

init();

// Registra cenas recursivamente pelo id, para evitar duplicação
function registrarCenasRecursivamente(cena) {
    if (!cena || scenesData[`panorama${cena.id}`]) return;
    scenesData[`panorama${cena.id}`] = cena;
    for (const hotspot of cena.hotspots || []) {
        if (hotspot.cena_destino) {
            registrarCenasRecursivamente(hotspot.cena_destino);
        }
    }
}

// Pré-carrega texturas de panorama e ícones dos hotspots
async function preloadTextures(cena) {
    if (!cena || textureCache[`panorama${cena.id}`]) return;

    const panoramaTexture = await textureLoader.loadAsync(cena.image);
    panoramaTexture.encoding = THREE.sRGBEncoding;
    panoramaTexture.minFilter = THREE.LinearFilter;
    panoramaTexture.magFilter = THREE.LinearFilter;
    panoramaTexture.generateMipmaps = false;
    panoramaTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    textureCache[`panorama${cena.id}`] = panoramaTexture;

    for (const hotspot of cena.hotspots || []) {
        if (hotspot.icon && !textureCache[hotspot.icon]) {
            const iconTexture = await textureLoader.loadAsync(hotspot.icon);
            iconTexture.encoding = THREE.sRGBEncoding;
            textureCache[hotspot.icon] = iconTexture;
        }
        if (hotspot.cena_destino) {
            await preloadTextures(hotspot.cena_destino);
        }
    }
}

// Salva o histórico de cenas no localStorage (sem duplicação)
function salvarHistoricoCena(cenaId) {
    //historico salva um array das cenas já visitadas
    let historico = JSON.parse(localStorage.getItem('historicoCenas') || '[]');
    if (!historico.includes(cenaId)) {
        historico.push(cenaId);
        localStorage.setItem('historicoCenas', JSON.stringify(historico));
    }
}

// Carrega cenas e inicia pela primeira
carregarTodasAsCenas(1).then(async data => {
    if (data) {
        registrarCenasRecursivamente(data);
        await preloadTextures(data);
        loadScene(`panorama${data.id}`);

        // Esconde tela de carregamento após carregar primeira cena
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
        }
    }
});

// Inicia animação
animate();

function init() {
    // Cena
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Câmera
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    camera.lookAt(new THREE.Vector3(0, 1.6, -1));

    // Renderizador
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    // Controles Orbit para modo não-VR
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1;
    controls.maxDistance = 100;
    controls.dampingFactor = 0.2;
    controls.rotateSpeed = -0.3;
    controls.target.set(0, 1.6, -1);
    controls.update();

    // Raycaster
    raycaster = new THREE.Raycaster();
    tempMatrix = new THREE.Matrix4();

    // Controladores VR com eventos e laser visível
    const controllerModelFactory = new XRControllerModelFactory();
    const handModelFactory = new XRHandModelFactory();

    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStart);
    scene.add(controller2);

    // Adiciona laser visual
    function addLaser(controller) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1)
        ]);
        const material = new THREE.LineBasicMaterial({
            color: 0xffffff,
            linewidth: 2,
            transparent: true,
            opacity: 0.9
        });
        const line = new THREE.Line(geometry, material);
        line.name = 'laser';
        line.scale.z = 100;
        controller.add(line);
    }

    addLaser(controller1);
    addLaser(controller2);

    // Control grips (modelo visual do controle físico)
    const controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
    scene.add(controllerGrip1);

    const controllerGrip2 = renderer.xr.getControllerGrip(1);
    controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
    scene.add(controllerGrip2);

    // Mãos (opcional)
    const hand1 = renderer.xr.getHand(0);
    hand1.add(handModelFactory.createHandModel(hand1));
    scene.add(hand1);

    const hand2 = renderer.xr.getHand(1);
    hand2.add(handModelFactory.createHandModel(hand2));
    scene.add(hand2);

    // Plano preto para transição com fade
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

    // Sprite de descrição
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.font = '36px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.fillText('', canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    descricaoSprite = new THREE.Sprite(material);
    descricaoSprite.scale.set(10, 2.5, 1);
    descricaoSprite.visible = false;
    scene.add(descricaoSprite);

    // Eventos
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('mousemove', (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    });
}

// Atualiza o texto do sprite com quebra de linhas e fundo arredondado
function atualizarDescricaoTexto(texto) {
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

    // Dividir texto em linhas
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

    // Medidas da caixa
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

    // Fundo com gradiente e borda suave
    const gradient = ctx.createLinearGradient(0, boxY, 0, boxY + boxHeight);
    gradient.addColorStop(0, 'rgba(30,30,30,0.9)');
    gradient.addColorStop(1, 'rgba(10,10,10,0.9)');

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

    // Desenhar texto com sombra
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], width / 2, boxY + paddingY + i * lineHeight);
    }

    ctx.shadowColor = 'transparent'; // remove sombra para próximas renderizações
    descricaoSprite.material.map.needsUpdate = true;
}

// Controla efeito de fade in/out para transição entre cenas
function startFade(direction, callback) {
    fadeDirection = direction;
    fadeCallback = callback;
    fading = true;
}

// Carrega uma cena com base no nome
function loadScene(sceneName, cenaOrigemId) {
    const data = scenesData[sceneName];
    if (!data) {
        console.warn(`Cena "${sceneName}" não encontrada.`);
        return;
    }
    cenaAtualId = data.id

    console.log('Carregando cena:', sceneName);
    console.log('entrada_rotacao_y recebida:', data.entrada_rotacao_y);

    savedCameraQuaternion.copy(camera.quaternion);
    salvarHistoricoCena(data.id);

    // Remove panorama atual
    if (currentPanoramaMesh) {
        scene.remove(currentPanoramaMesh);
        disposeMesh(currentPanoramaMesh);
        currentPanoramaMesh = null;
    }

    // Remove hotspots antigos
    hotspotMeshes.forEach(mesh => disposeMesh(mesh));
    hotspotMeshes = [];

    // Cria geometria da esfera panorâmica invertida
    const geometry = new THREE.SphereGeometry(50, 128, 128);
    geometry.scale(-1, 1, 1);

    const texture = textureCache[`panorama${data.id}`];
    if (!texture) {
        console.warn(`Textura não encontrada para a cena: ${sceneName}`);
        return;
    }

    const material = new THREE.MeshBasicMaterial({ map: texture });
    currentPanoramaMesh = new THREE.Mesh(geometry, material);
    currentPanoramaMesh.userData.ignoreRaycast = true;
    scene.add(currentPanoramaMesh);

    // Ajusta posição vertical da esfera conforme VR ou desktop
    //currentPanoramaMesh.position.y = renderer.xr.isPresenting ? -1.6 : 0;

    // Cria hotspots
    const radius = 20;
    data.hotspots.forEach((hotspot, index) => {
        let mat;
        if (hotspot.icon && textureCache[hotspot.icon]) {
            mat = new THREE.SpriteMaterial({ map: textureCache[hotspot.icon], transparent: true, alphaTest: 0.01 });
        } else {
            mat = new THREE.SpriteMaterial({ color: 0xffff00 });
        }

        const sprite = new THREE.Sprite(mat);

        sprite.userData = {
            target: hotspot.target,
            descricao: hotspot.name,
            entrada_rotacao_y: hotspot.entrada_rotacao_y
        };

        // Posiciona hotspot
        if (
            typeof hotspot.pos_x === 'number' &&
            typeof hotspot.pos_y === 'number' &&
            typeof hotspot.pos_z === 'number'
        ) {
            sprite.position.set(hotspot.pos_x, hotspot.pos_y, hotspot.pos_z);

            // Ajusta altura do hotspot em VR
            if (renderer.xr.isPresenting) {
                sprite.position.y -= 1.6;
            }
        } else {
            // Posiciona em círculo caso não haja posição explícita
            const angle = (index / data.hotspots.length) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const y = 5;
            const z = Math.sin(angle) * radius;
            sprite.position.set(x, y, z);
        }

        sprite.scale.set(2.5, 2.5, 1);
        hotspotMeshes.push(sprite);
        scene.add(sprite);
    });

    console.log('Cena carregada:', sceneName);

    // Aplica rotação inicial da câmera para orientar panorama
    if (!renderer.xr.isPresenting) {
        let rotacaoY = 0;

        if (cenaOrigemId) {
            const hotspotEntrada = data.hotspots.find(hotspot => {
                const destinoId = hotspot.cena_destino?.id;
                return destinoId === cenaOrigemId;
            });

            if (hotspotEntrada) {
                rotacaoY = calcularRotacaoYDoHotspot(hotspotEntrada.pos_x, hotspotEntrada.pos_y, hotspotEntrada.pos_z);
                console.log(`Rotação Y calculada a partir do hotspot de entrada: ${rotacaoY.toFixed(3)} rad`);
            } else {
                rotacaoY = (typeof data.entrada_rotacao_y === 'number') ? data.entrada_rotacao_y : Math.PI / 2;
                console.warn(`Hotspot de entrada para cena ${cenaOrigemId} não encontrado. Usando entrada_rotacao_y ou padrão.`);
            }
        } else {
            rotacaoY = (typeof data.entrada_rotacao_y === 'number') ? data.entrada_rotacao_y : Math.PI / 2;
        }

        aplicarRotacaoCamera(rotacaoY);
    }
}

// Evento de clique nos controles VR
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
                loadScene(target,cenaAtualId);
                startFade(-1);
            });
        }
    }
}

// Clique no mouse (modo desktop)
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

// Ajusta tamanho do canvas e câmera ao redimensionar
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Calcula o ângulo Y entre o hotspot e a origem
function calcularRotacaoYDoHotspot(pos_x, pos_y, pos_z) {
    //Faz com que ao entrar numa cena clicando num hotspot,
    // a câmera esteja olhando na direção do hotspot de onde o usuário veio
    const dir = new THREE.Vector3(pos_x, pos_y, pos_z).normalize();
    return Math.atan2(dir.x, dir.z);
}

// Aplica rotação à câmera via quaternion
function aplicarRotacaoCamera(rotacaoY) {
    const quat = new THREE.Quaternion();
    quat.setFromEuler(new THREE.Euler(0, rotacaoY, 0));
    camera.quaternion.copy(quat);

    console.log(`>> Câmera rotacionada para Y: ${rotacaoY.toFixed(3)} rad`);
}
// Loop de animação com suporte a XR
function animate() {
    renderer.setAnimationLoop(render);
}

// Renderiza quadro a quadro
function render() {
    const delta = clock.getDelta();

    // Atualiza fade in/out
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

    // Mantém plano de fade sempre à frente da câmera
    fadePlane.position.copy(camera.position);
    fadePlane.quaternion.copy(camera.quaternion);
    fadePlane.translateZ(-0.5);

    if (!renderer.xr.isPresenting && controls) controls.update();

    // Variável para armazenar o hotspot que está sendo apontado atualmente (pelo laser ou mouse)
    let intersected = null;

// Verifica se está em modo VR (óculos)
    if (renderer.xr.isPresenting) {
        // Para cada um dos dois controladores VR (esquerdo e direito)
        [controller1, controller2].forEach(controller => {
            // Prepara uma matriz temporária para extrair a rotação do controle
            tempMatrix.identity().extractRotation(controller.matrixWorld);

            // Define a origem do raio (raycaster) como a posição do controle no mundo
            raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);

            // Define a direção do raio como "para frente" do controle, considerando sua rotação
            raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

            // Detecta interseções entre o raio e os hotspots
            const intersects = raycaster.intersectObjects(hotspotMeshes, false);

            // Se houver interseção e ainda não foi definido um `intersected`, usa esse objeto
            if (intersects.length > 0 && !intersected) {
                intersected = intersects[0].object; // O hotspot que está sendo apontado pelo controle
            }
        });
    } else {
        // Modo não-VR (desktop): calcula a direção do raio com base na posição do mouse na tela
        raycaster.setFromCamera(mouse, camera);

        // Verifica se o raio colide com algum hotspot na cena
        const intersects = raycaster.intersectObjects(hotspotMeshes, false);

        // Se houver interseção, armazena o primeiro objeto encontrado como `intersected`
        if (intersects.length > 0) {
            intersected = intersects[0].object; // O hotspot que está sob o ponteiro do mouse
        }
    }




    // Atualiza descrição do hotspot se houver
    if (intersected) {
        atualizarDescricaoTexto(intersected.userData.descricao || '');
        descricaoSprite.position.copy(intersected.position);
        descricaoSprite.position.y += 3;
        descricaoSprite.lookAt(camera.position);
        descricaoSprite.visible = true;
    } else {
        descricaoSprite.visible = false;
    }

    renderer.render(scene, camera);
}

// Remove geometria e materiais de malha para liberar memória
function disposeMesh(mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
        if (mesh.material.map) mesh.material.map.dispose();
        mesh.material.dispose();
    }
    scene.remove(mesh);
}