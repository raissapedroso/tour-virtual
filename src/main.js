// Importa as dependências principais do Three.js
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { carregarTodasAsCenas } from './scenes/scenesFetcher.js';

// Variáveis principais da cena
let camera, scene, renderer, controls, raycaster, tempMatrix;
let hotspotMeshes = [], currentPanoramaMesh = null;
let fadePlane, fadeOpacity = 0, fading = false, fadeDirection = 1, fadeCallback = null;
const clock = new THREE.Clock();
const mouse = new THREE.Vector2();
let savedCameraQuaternion = new THREE.Quaternion();
let scenesData = {};
let controller1, controller2;
let descricaoSprite = null;
const textureCache = {};
const textureLoader = new THREE.TextureLoader();

init();

// Registra cenas recursivamente com base em seus hotspots
function registrarCenasRecursivamente(cena) {
    if (!cena || scenesData[`panorama${cena.id}`]) return;
    scenesData[`panorama${cena.id}`] = cena;
    for (const hotspot of cena.hotspots || []) {
        if (hotspot.cena_destino) {
            registrarCenasRecursivamente(hotspot.cena_destino);
        }
    }
}

// Pré-carrega todas as texturas de uma cena e suas dependências
async function preloadTextures(cena) {
    if (!cena || textureCache[`panorama${cena.id}`]) return;

    // Carrega textura do panorama
    const panoramaTexture = await textureLoader.loadAsync(cena.image);
    panoramaTexture.encoding = THREE.sRGBEncoding;
    panoramaTexture.minFilter = THREE.LinearFilter;
    panoramaTexture.magFilter = THREE.LinearFilter;
    panoramaTexture.generateMipmaps = false;
    panoramaTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    textureCache[`panorama${cena.id}`] = panoramaTexture;

    // Carrega ícones de hotspots
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

// Salva o ID da cena no histórico no localStorage
function salvarHistoricoCena(cenaId) {
    let historico = JSON.parse(localStorage.getItem('historicoCenas') || '[]');
    if (!historico.includes(cenaId)) {
        historico.push(cenaId);
        localStorage.setItem('historicoCenas', JSON.stringify(historico));
    }
}

// Carrega as cenas e inicia com a primeira cena (id 1)
carregarTodasAsCenas(1).then(async data => {
    if (data) {
        registrarCenasRecursivamente(data);
        await preloadTextures(data);
        loadScene(`panorama${data.id}`);
    }
});

// Inicia o loop de animação
animate();

// Função principal de configuração do ambiente 3D
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    camera.lookAt(new THREE.Vector3(0, 1.6, -1));

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
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

    // Controladores VR básicos
    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStart);
    scene.add(controller2);

    // Linhas de apontamento dos controladores
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

    // Controladores 3D e mãos visíveis
    const controllerModelFactory = new XRControllerModelFactory();
    const handModelFactory = new XRHandModelFactory();

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

    // Plano de fade preto
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

    // Descrição de hotspots (sprite)
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

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('mousemove', (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    });
}

// Função auxiliar para atualizar o texto do sprite
function atualizarDescricaoTexto(texto) {
    const canvas = descricaoSprite.material.map.image;
    const ctx = canvas.getContext('2d');

    // Definir tamanho fixo do canvas (não muda)
    const width = 512;
    const height = 128;
    canvas.width = width;
    canvas.height = height;

    // Limpar o canvas
    ctx.clearRect(0, 0, width, height);

    // Configurações de fonte (fixa, legível, sem distorção)
    const fontSize = 32;
    ctx.font = `${fontSize}px Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'white';

    // Quebra de linha simples
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

    // Medir largura e altura do texto para ajustar fundo
    let maxLineWidth = 0;
    lines.forEach(line => {
        const lineWidth = ctx.measureText(line).width;
        if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
    });

    const lineHeight = fontSize * 1.2;
    const textHeight = lines.length * lineHeight;
    const paddingX = 15;
    const paddingY = 10;

    const boxWidth = maxLineWidth + paddingX * 2;
    const boxHeight = textHeight + paddingY * 2;
    const boxX = (width - boxWidth) / 2;
    const boxY = (height - boxHeight) / 2;

    // Fundo preto arredondado ajustado ao texto
    const radius = 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
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

    // Desenhar texto linha por linha centralizado verticalmente
    ctx.fillStyle = 'white';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const x = width / 2;
        const y = boxY + paddingY + i * lineHeight;
        ctx.fillText(line, x, y);
    }

    descricaoSprite.material.map.needsUpdate = true;
}

// Inicia efeito de fade in/out
function startFade(direction, callback) {
    fadeDirection = direction;
    fadeCallback = callback;
    fading = true;
}

// Carrega e exibe uma cena com base no nome dela
function loadScene(sceneName) {
    const data = scenesData[sceneName];
    if (!data) {
        console.warn(`Cena "${sceneName}" não encontrada.`);
        return;
    }
    console.log('Carregando cena:', sceneName);
    console.log('entrada_rotacao_y recebida:', data.entrada_rotacao_y);

    // Salva a rotação atual da câmera antes de mudar (para fallback)
    savedCameraQuaternion.copy(camera.quaternion);

    // Salva o histórico de navegação
    salvarHistoricoCena(data.id);

    // Remove o panorama anterior, se existir
    if (currentPanoramaMesh) {
        scene.remove(currentPanoramaMesh);
        disposeMesh(currentPanoramaMesh);
        currentPanoramaMesh = null;
    }

    // Remove todos os hotspots anteriores
    hotspotMeshes.forEach(mesh => disposeMesh(mesh));
    hotspotMeshes = [];

    // Cria a esfera panorâmica
    const geometry = new THREE.SphereGeometry(50, 128, 128);
    geometry.scale(-1, 1, 1);

    // Recupera a textura da cena
    const texture = textureCache[`panorama${data.id}`];
    if (!texture) {
        console.warn(`Textura não encontrada para a cena: ${sceneName}`);
        return;
    }

    // Cria o material e mesh do panorama
    const material = new THREE.MeshBasicMaterial({ map: texture });
    currentPanoramaMesh = new THREE.Mesh(geometry, material);
    currentPanoramaMesh.userData.ignoreRaycast = true;
    scene.add(currentPanoramaMesh);

    // Adiciona os hotspots da cena
    const radius = 20;
    data.hotspots.forEach((hotspot, index) => {
        let mat;
        if (hotspot.icon && textureCache[hotspot.icon]) {
            mat = new THREE.SpriteMaterial({ map: textureCache[hotspot.icon], transparent: true, alphaTest: 0.01 });
        } else {
            mat = new THREE.SpriteMaterial({ color: 0xffff00 });
        }

        const sprite = new THREE.Sprite(mat);

        // Armazena dados úteis para o clique
        sprite.userData = {
            target: hotspot.target,
            descricao: hotspot.name,
            entrada_rotacao_y: hotspot.entrada_rotacao_y // incluímos aqui!
        };
        console.log(hotspot.entrada_rotacao_y);
        console.log('posição do hotspot x: ' + hotspot.pos_x);
        console.log('posição do hotspot y: ' + hotspot.pos_y);
        console.log('posição do hotspot z: ' + hotspot.pos_z);

        if (
            typeof hotspot.pos_x === 'number' &&
            typeof hotspot.pos_y === 'number' &&
            typeof hotspot.pos_z === 'number'
        ) {
            sprite.position.set(hotspot.pos_x, hotspot.pos_y, hotspot.pos_z);
        } else {
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

    console.log('aaaaaaa');
    console.log('cena: ' + sceneName);

    // Aplica a rotação da câmera ao entrar na nova cena (se não estiver em modo VR)
    if (!renderer.xr.isPresenting) {
        // Define um valor padrão para entrada_rotacao_y caso seja null ou undefined
        let rotacaoY = 0; // padrão (0 radianos)
        if (typeof data.entrada_rotacao_y === 'number') {
            rotacaoY = data.entrada_rotacao_y;
        } else {
            console.warn(`entrada_rotacao_y está nulo ou indefinido para a cena ${sceneName}. Usando padrão 0.`);
        }

        const euler = new THREE.Euler(0, rotacaoY, 0, 'YXZ');
        camera.quaternion.setFromEuler(euler);
        console.log('Aplicando rotação da entrada:', rotacaoY);
    }
}



// Clique no controle VR
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

// Clique no mouse (modo não VR)
function onPointerDown(event) {
    if (renderer.xr.isPresenting) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(hotspotMeshes, false);
    if (intersects.length > 0) {
        const target = intersects[0].object.userData.target;
        console.log(target)
        if (target) {
            startFade(1, () => {
                loadScene(target);
                startFade(-1);
            });
        }
    }
    console.log('Hotspot clicado:', hotspot);
    console.log('Cena destino:', target);
    console.log('Yaw do hotspot:', yaw);

}

// Ajusta proporções da câmera ao redimensionar
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Inicia o render loop com suporte a XR
function animate() {
    renderer.setAnimationLoop(render);
}

// Função que renderiza cada frame
function render() {
    const delta = clock.getDelta();

    // Animação do fade in/out
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

    // Sempre posiciona o plano de fade à frente da câmera
    fadePlane.position.copy(camera.position);
    fadePlane.quaternion.copy(camera.quaternion);
    fadePlane.translateZ(-0.5);

    if (!renderer.xr.isPresenting && controls) controls.update();

    // Detecta se o mouse ou controle VR está apontando para algum hotspot
    let intersected = null;
    if (renderer.xr.isPresenting) {
        tempMatrix.identity().extractRotation(controller1.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
        const intersects = raycaster.intersectObjects(hotspotMeshes, false);
        if (intersects.length > 0) intersected = intersects[0].object;
    } else {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(hotspotMeshes, false);
        if (intersects.length > 0) intersected = intersects[0].object;
    }

    // Se houver hotspot sob o ponteiro, exibe a descrição
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

// Remove malhas da cena e limpa memória
function disposeMesh(mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material?.map) mesh.material.map.dispose();
    if (mesh.material) mesh.material.dispose();
    scene.remove(mesh);
}