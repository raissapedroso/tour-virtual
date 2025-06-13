import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'; //permite mover a câmera com o mouse fora do modo VR.
import { scenesData } from "./scenes/scenesData.js";

let camera, scene, renderer;
let controller1, controller2;
let controls;
let raycaster, tempMatrix;
let hotspotMeshes = [];
let currentPanoramaMesh = null;

const mouse = new THREE.Vector2();

//Inicializa o ambiente da aplicação.
init();
//Carrega uma cena específica, chamada 'panorama1'.
loadScene('panorama0');
//Inicia o loop de animação.
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 0);

    const light = new THREE.HemisphereLight(0xffffff, 0x444444);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    // Controles para modo não-VR
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1;
    controls.maxDistance = 100;
    controls.dampingFactor = 0.2; //suavização
    controls.rotateSpeed = 0.3; //velocidade da rotação do mouse

    raycaster = new THREE.Raycaster();
    raycaster.camera = camera;
    tempMatrix = new THREE.Matrix4();

    // Controller VR
    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStart);
    scene.add(controller2);

// Adiciona o laser (linha) para os dois controles
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

    //addEventListener() registra uma única espera de evento em um único alvo.
    // O alvo do evento pode ser um único elemento em um documento, o documento em si,
    // uma janela, ou um XMLHttpRequest.
    // Para registrar mais de uma espera de evento como alvo, chame addEventListener()
    // para o mesmo alvo mas com diferentes tipos de evento ou captura de parâmetros.
    //Aqui ele registra qual evento foi feito e chama a determinada função para isso
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointerdown', onPointerDown, false); //evento que pega mouse e celular
}

function loadScene(sceneName) {
    const data = scenesData[sceneName];

    //Em vez de carregar todas as imagens no início, carregue somente a imagem da cena atual e libere da memória as anteriores
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

    //É criado uma esfera gigante invertida (o lado de dentro é visível).
    const geometry = new THREE.SphereGeometry(50, 128, 128);
    geometry.scale(-1, 1, 1);

    //Aqui é aplicado uma imagem panorâmica como textura:
    const texture = new THREE.TextureLoader().load(data.image, (tex) => {
        tex.minFilter = THREE.LinearMipMapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    });

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: false,
        opacity: 1
    });

    // transição simples para a mudança de cena (deve ser melhorado!)
    /*let opacity = 0;
    const interval = setInterval(() => {
        opacity += 0.05;
        if (currentPanoramaMesh) currentPanoramaMesh.material.opacity = opacity;
        if (opacity >= 1) clearInterval(interval);
    }, 30);*/


    currentPanoramaMesh = new THREE.Mesh(geometry, material);
    currentPanoramaMesh.userData.ignoreRaycast = true;
    scene.add(currentPanoramaMesh);

    data.hotspots.forEach(hotspot => {
        let material;
        if (hotspot.icon) {
            //imagem do hotspots
            const texture = new THREE.TextureLoader().load('click.png');
            material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                alphaTest: 0.01
            });
        } else {
            material = new THREE.SpriteMaterial({ color: 0xffff00 });
        }

        const sprite = new THREE.Sprite(material);
        sprite.position.set(hotspot.position.x, hotspot.position.y, hotspot.position.z);
        sprite.scale.set(2.5, 2.5, 1); // ajuste o tamanho da imagem do hotspots, conforme necessário
        sprite.userData.target = hotspot.target;
        hotspotMeshes.push(sprite);
        scene.add(sprite);
    });

}

//Clique com controle do óculos
//Quando o usuário clica ou aperta um botão no controle VR (por exemplo, o gatilho).
//Ela verifica se o controle está apontando para algum hotspot, e se estiver, muda de cena.
function onSelectStart(event) {
    //Pega qual controle disparou o evento (pode ser controller1 ou controller2).
    const thisController = event.target;

    //Serve para saber para onde o controle está apontando.
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(thisController.matrixWorld);

    //origem e direção do raio
    raycaster.ray.origin.setFromMatrixPosition(thisController.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    //Verifica quais objetos (hotspots) estão sendo tocados por esse raio invisível
    const intersects = raycaster.intersectObjects(hotspotMeshes, false);
    //Se o controle está apontando para algum hotspot...
    if (intersects.length > 0) {
        //Pega o valor target que foi armazenado nos dados extras (userData) do objeto atingido. Isso geralmente é um nome de cena, link, ou identificador.
        const target = intersects[0].object.userData.target;
        //Se existir um destino (target), chama a função loadScene() para carregar uma nova cena.
        if (target) loadScene(target);
    }
}

// Clique com mouse e celular
function onPointerDown(event) {
    if (renderer.xr.isPresenting) return;

    console.log('evento pointer');

    let x, y;
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        x = event.clientX;
        y = event.clientY;
    } else if (event.pointerType === 'mouse') {
        console.log('toque do mouse')
        x = event.clientX;
        y = event.clientY;
    }

    mouse.x = (x / window.innerWidth) * 2 - 1;
    mouse.y = -(y / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(hotspotMeshes, false);
    if (intersects.length > 0) {
        const target = intersects[0].object.userData.target;
        if (target) loadScene(target);
    }
}


//Essa função faz com que a cena continue aparecendo do jeito certo mesmo quando a janela muda de tamanho.
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    if (!renderer.xr.isPresenting && controls) controls.update();

    // Resetar todas as cores dos hotspots
    hotspotMeshes.forEach(mesh => mesh.material.color.set(0xffff00));

    if (renderer.xr.isPresenting) {
        checkIntersection(controller1);
        checkIntersection(controller2);
    }

    renderer.render(scene, camera);
}

//A função 'checkIntersection' pega a posição e direção do controle.
// Cria um raio invisível que sai da ponta do controle e vai na direção que ele está apontando.
// Verifica se esse raio acerta algum objeto (hotspot).
// Se acertar, muda a cor do objeto atingido para vermelho.
function checkIntersection(controller) {
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(hotspotMeshes, false);
    if (intersects.length > 0) {
        intersects[0].object.material.color.set(0xff0000);
    }
}
