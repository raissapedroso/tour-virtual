import * as THREE from 'three';

/**
 * DeviceOrientationCamera
 * Classe que aplica DeviceOrientation ao quaternion da câmera,
 * com unwrap acumulativo de alpha para permitir giro contínuo
 * e conversão correta de eixos (implementação inspirada em DeviceOrientationControls).
 */
class DeviceOrientationCamera {
    constructor(camera, renderer, { slerpFactor = 0.65, yawSpeed = 2.5, pitchSpeed = 1.3 } = {}) {
        this.camera = camera;
        this.renderer = renderer;

        this.enabled = false;
        this.deviceOrientation = null;

        // Sensibilidade yaw/pitch
        this.yawSpeed = yawSpeed;
        this.pitchSpeed = pitchSpeed;

        // Calibração yaw inicial
        this.alphaOffset = 0;

        // Auxiliares
        this.zee = new THREE.Vector3(0, 0, 1);
        this.q0 = new THREE.Quaternion();
        this.q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 sobre X
        this.smoothedQuaternion = new THREE.Quaternion();
        this.initialQuaternion = new THREE.Quaternion();

        // Suavização
        this.slerpFactor = slerpFactor;

        // Unwrap / acumulador yaw
        this.yawAccum = 0;
        this.lastRawAlpha = null;

        // Orientação da tela
        this.screenOrientation = 0;

        // Controle de interação manual
        this.isUserInteracting = false;

        // Detectar Android
        this.isAndroid = /Android/i.test(navigator.userAgent);

        // Configurações padrão
        this.filterFactor = 0.2;
        this.historySize = 3;
        this.updateFrequency = 60;
        this.deltaThreshold = THREE.MathUtils.degToRad(0.5);
        this.stationaryThreshold = THREE.MathUtils.degToRad(0.8);
        this.stationaryFrames = 10;

        // Ajustes especiais para Android
        if (this.isAndroid) {
            this.slerpFactor = 0.5;       // acompanha mais rápido
            this.filterFactor = 0.15;     // menos suavização
            this.historySize = 3;
            this.updateFrequency = 60;    // mais frequência
            this.deltaThreshold = THREE.MathUtils.degToRad(0.5);
            this.stationaryThreshold = THREE.MathUtils.degToRad(0.8);
            this.stationaryFrames = 10;
        }

        this.minUpdateInterval = 1000 / this.updateFrequency;

        // Históricos
        this.deltaHistory = [];
        this.betaHistory = [];
        this.gammaHistory = [];

        // Controle de atualização
        this.lastUpdateTime = 0;

        // Estado estacionário
        this.lastRawBeta = null;
        this.lastRawGamma = null;
        this.stationaryCounter = 0;

        // Filtros suavizados
        this.smoothedAlphaAccum = 0;
        this.smoothedBeta = 0;
        this.smoothedGamma = 0;
        this.orientationFilterInitialized = false;

        // Bind
        this.onDeviceOrientation = this.onDeviceOrientation.bind(this);
        this.onScreenOrientationChange = this.onScreenOrientationChange.bind(this);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);

        // UI debug opcional
        this.createDebugInterface();

        // Eventos
        this.connect();

        // Inicializa quaternion suavizado
        this.smoothedQuaternion.copy(this.camera.quaternion);
        this.initialQuaternion.copy(this.camera.quaternion);
    }

    connect() {
        window.addEventListener('deviceorientation', this.onDeviceOrientation, false);
        window.addEventListener('orientationchange', this.onScreenOrientationChange, false);
        window.addEventListener('touchstart', this.onTouchStart, false);
        window.addEventListener('touchend', this.onTouchEnd, false);
        this.onScreenOrientationChange();
    }

    disconnect() {
        window.removeEventListener('deviceorientation', this.onDeviceOrientation, false);
        window.removeEventListener('orientationchange', this.onScreenOrientationChange, false);
        window.removeEventListener('touchstart', this.onTouchStart, false);
        window.removeEventListener('touchend', this.onTouchEnd, false);
        this.enabled = false;
        this.removeDebugInterface();
    }

    requestPermission() {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response === 'granted') {
                        this.enabled = true;
                        this.resetOrientation();
                    } else {
                        this.enabled = false;
                        alert('Permissão para DeviceOrientation negada.');
                    }
                })
                .catch(err => {
                    this.enabled = false;
                    console.error('Erro ao pedir permissão DeviceOrientation:', err);
                    alert('Erro ao pedir permissão DeviceOrientation: ' + err.message);
                });
        } else {
            this.enabled = true;
            this.resetOrientation();
        }
    }

    onDeviceOrientation(event) {
        if (!this.enabled || !event || (this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) || this.isUserInteracting) {
            return;
        }
        this.deviceOrientation = {
            alpha: event.alpha,
            beta: event.beta,
            gamma: event.gamma,
            absolute: event.absolute
        };
        this.updateDebugUI();
    }

    onScreenOrientationChange() {
        const s = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
        this.screenOrientation = s;
    }

    onTouchStart() {
        this.isUserInteracting = true;
    }
    onTouchEnd() {
        setTimeout(() => (this.isUserInteracting = false), 300);
    }

    degToRad(d) {
        return THREE.MathUtils.degToRad(d || 0);
    }

    setObjectQuaternion(quaternion, alpha, beta, gamma, orient) {
        const adjustedAlpha = alpha * this.yawSpeed; // Removida inversão no Android
        const adjustedBeta = beta * this.pitchSpeed;
        const euler = new THREE.Euler(adjustedBeta, adjustedAlpha, -gamma, 'YXZ');
        quaternion.setFromEuler(euler);
        quaternion.multiply(this.q1);
        this.q0.setFromAxisAngle(this.zee, -orient);
        quaternion.multiply(this.q0);
    }

    update() {
        if (!this.enabled || !this.deviceOrientation || (this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) || this.isUserInteracting) {
            return;
        }

        const now = performance.now();
        if (now - this.lastUpdateTime < this.minUpdateInterval) {
            return;
        }
        this.lastUpdateTime = now;

        const rawAlpha = this.degToRad(this.deviceOrientation.alpha);
        const rawBeta = this.degToRad(this.deviceOrientation.beta);
        const rawGamma = this.degToRad(this.deviceOrientation.gamma || 0);

        const filteredAlpha = this.filterFactor * rawAlpha + (1 - this.filterFactor) * (this.lastRawAlpha ?? rawAlpha);
        const filteredBeta  = this.filterFactor * rawBeta  + (1 - this.filterFactor) * (this.lastRawBeta  ?? rawBeta);
        const filteredGamma = this.filterFactor * rawGamma + (1 - this.filterFactor) * (this.lastRawGamma ?? rawGamma);

        let isStationary = false;
        if (this.lastRawAlpha !== null && this.lastRawBeta !== null && this.lastRawGamma !== null) {
            const deltaAlpha = Math.abs(filteredAlpha - this.lastRawAlpha);
            const deltaBeta = Math.abs(filteredBeta - this.lastRawBeta);
            const deltaGamma = Math.abs(filteredGamma - this.lastRawGamma);

            if (deltaAlpha < this.stationaryThreshold && deltaBeta < this.stationaryThreshold && deltaGamma < this.stationaryThreshold) {
                this.stationaryCounter++;
                if (this.stationaryCounter >= this.stationaryFrames) {
                    isStationary = true;
                }
            } else {
                this.stationaryCounter = 0;
            }
        }

        this.lastRawAlpha = filteredAlpha;
        this.lastRawBeta = filteredBeta;
        this.lastRawGamma = filteredGamma;

        let alphaAccum = this.yawAccum;
        if (this.lastRawAlpha !== null && !isStationary) {
            let rawDelta = filteredAlpha - (this.lastAlphaForAccum ?? filteredAlpha);
            if (rawDelta > Math.PI) rawDelta -= 2 * Math.PI;
            if (rawDelta <= -Math.PI) rawDelta += 2 * Math.PI;
            if (Math.abs(rawDelta) > this.deltaThreshold) {
                this.deltaHistory.push(rawDelta);
                if (this.deltaHistory.length > this.historySize) this.deltaHistory.shift();
                const avgDelta = this.deltaHistory.reduce((a, b) => a + b, 0) / this.deltaHistory.length;
                this.yawAccum += avgDelta;
            }
            alphaAccum = this.yawAccum + this.alphaOffset;
        }

        this.betaHistory.push(filteredBeta);
        if (this.betaHistory.length > this.historySize) this.betaHistory.shift();
        const avgBeta = this.betaHistory.reduce((a, b) => a + b, 0) / this.betaHistory.length;

        this.gammaHistory.push(filteredGamma);
        if (this.gammaHistory.length > this.historySize) this.gammaHistory.shift();
        const avgGamma = this.gammaHistory.reduce((a, b) => a + b, 0) / this.gammaHistory.length;

        if (!this.orientationFilterInitialized) {
            this.smoothedAlphaAccum = alphaAccum;
            this.smoothedBeta = avgBeta;
            this.smoothedGamma = avgGamma;
            this.orientationFilterInitialized = true;
        } else {
            this.smoothedAlphaAccum = this.filterFactor * alphaAccum + (1 - this.filterFactor) * this.smoothedAlphaAccum;
            this.smoothedBeta = this.filterFactor * avgBeta + (1 - this.filterFactor) * this.smoothedBeta;
            this.smoothedGamma = this.filterFactor * avgGamma + (1 - this.filterFactor) * this.smoothedGamma;
        }

        const orient = this.degToRad(this.screenOrientation);

        const targetQuat = new THREE.Quaternion();
        this.setObjectQuaternion(targetQuat, this.smoothedAlphaAccum, this.smoothedBeta, this.smoothedGamma, orient);

        this.smoothedQuaternion.slerp(targetQuat, this.slerpFactor);
        this.camera.quaternion.copy(this.smoothedQuaternion);

        if (this.camera.controls) {
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
            this.camera.controls.target.copy(direction).add(this.camera.position);
            this.camera.controls.enabled = false;
            this.camera.controls.update();
        }
    }

    resetOrientation() {
        this.alphaOffset = -this.yawAccum;
        this.yawAccum = 0;
        this.lastRawAlpha = null;
        this.lastRawBeta = null;
        this.lastRawGamma = null;
        this.stationaryCounter = 0;
        this.deltaHistory = [];
        this.betaHistory = [];
        this.gammaHistory = [];
        this.orientationFilterInitialized = false;
        this.initialQuaternion.copy(this.camera.quaternion);
        this.smoothedQuaternion.copy(this.camera.quaternion);
        this.updateDebugUI();
    }

    createDebugInterface() {
        // Interface de debug desativada
        this._debugEl = null;
    }

    updateDebugUI() {
        if (!this._debugEl) return;
        const alpha = this.deviceOrientation ? (this.deviceOrientation.alpha || 0) : 0;
        const beta = this.deviceOrientation ? (this.deviceOrientation.beta || 0) : 0;
        const gamma = this.deviceOrientation ? (this.deviceOrientation.gamma || 0) : 0;
        this._debugEl.querySelector('#do-alpha').textContent = `alpha: ${alpha.toFixed ? alpha.toFixed(2) : alpha}`;
        this._debugEl.querySelector('#do-yawAccum').textContent = `yawAccum (deg): ${THREE.MathUtils.radToDeg(this.yawAccum).toFixed(2)}`;
        this._debugEl.querySelector('#do-alphaFinal').textContent = `alphaFinal (deg): ${THREE.MathUtils.radToDeg(this.yawAccum + this.alphaOffset).toFixed(2)}`;
        this._debugEl.querySelector('#do-beta').textContent = `beta: ${beta.toFixed ? beta.toFixed(2) : beta}`;
        this._debugEl.querySelector('#do-gamma').textContent = `gamma: ${gamma.toFixed ? gamma.toFixed(2) : gamma}`;
    }

    removeDebugInterface() {
        if (this._debugEl && this._debugEl.parentNode) {
            this._debugEl.parentNode.removeChild(this._debugEl);
            this._debugEl = null;
        }
    }
}

export { DeviceOrientationCamera };
