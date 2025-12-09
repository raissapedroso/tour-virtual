import * as THREE from 'three';

class DeviceOrientationCamera {
  constructor(camera, renderer) {
    // Referências principais
    this.camera = camera;
    this.renderer = renderer;

    // Estado inicial
    this.enabled = false;
    this.deviceOrientation = {};
    this.screenOrientation = 0;

    // Detecta sistema operacional
    const ua = window.navigator.userAgent;
    const platform = window.navigator.platform;
    const iosPlatforms = ['iPhone', 'iPad', 'iPod'];
    this.isIOS = iosPlatforms.includes(platform) || /iPad|iPhone|iPod/.test(ua);
    console.log(`Plataforma detectada: ${this.isIOS ? 'iOS' : 'Android'}`);

    // Quaternions de referência e buffers
    this.q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // ajuste base
    this.target = new THREE.Quaternion();   // alvo de rotação
    this.smoothed = new THREE.Quaternion(); // rotação suavizada

    // Filtro de Kalman
    this.kalman = {
      q: 0.01, // incerteza do processo
      r: 0.03, // incerteza da medição
      x: 0,
      p: 1,
      k: 0
    };

    // Estado de rotação
    this.yawAccum = 0;
    this.lastAlpha = null;
    this.lastGamma = null;
    this.alphaOffset = 0;

    // Suavização e sensibilidade
    this.deadzone = THREE.MathUtils.degToRad(0.1);
    this.slerpFactor = 0.2;
    this.minMovement = THREE.MathUtils.degToRad(0.05);

    // Atualização (taxa de frames)
    this.lastUpdate = 0;
    this.updateInterval = 1000 / 90;

    // Vincula eventos
    this.onDeviceOrientation = this.onDeviceOrientation.bind(this);
    this.onScreenOrientationChange = this.onScreenOrientationChange.bind(this);
    this.connect();
  }

  // Conexão e permissão

  connect() {
    window.addEventListener('deviceorientation', this.onDeviceOrientation, { passive: true });
    window.addEventListener('orientationchange', this.onScreenOrientationChange, { passive: true });
    this.onScreenOrientationChange();
  }

  async requestPermission() {
    // iOS exige permissão explícita
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        this.enabled = res === 'granted';
      } catch (e) {
        console.warn('⚠️ Permissão de orientação negada:', e);
        this.enabled = false;
      }
    } else {
      // Android e outros navegadores não exigem
      this.enabled = true;
    }

    if (this.enabled) {
      this.resetOrientation();
      console.log('✅ Sensores ativados com sucesso');
    }

    return this.enabled;
  }

  disconnect() {
    window.removeEventListener('deviceorientation', this.onDeviceOrientation, true);
    window.removeEventListener('orientationchange', this.onScreenOrientationChange, true);
    this.enabled = false;
  }

  onScreenOrientationChange() {
    this.screenOrientation = window.orientation || 0;
  }

  onDeviceOrientation(event) {
    if (!this.enabled) return;
    this.deviceOrientation = {
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma
    };
  }

  // Filtro de Kalman — suaviza ruído no Android
  _kalmanFilter(measurement) {
    const kf = this.kalman;
    kf.p += kf.q;
    kf.k = kf.p / (kf.p + kf.r);
    kf.x += kf.k * (measurement - kf.x);
    kf.p *= (1 - kf.k);
    return kf.x;
  }

  // Atualização de rotação (executa no render loop)
  update() {
    if (!this.enabled || this.deviceOrientation.alpha == null) return;

    const now = performance.now();
    if (now - this.lastUpdate < this.updateInterval) return;
    this.lastUpdate = now;

    let { alpha, beta, gamma } = this.deviceOrientation;
    const orient = THREE.MathUtils.degToRad(this.screenOrientation);

    let betaRad = THREE.MathUtils.degToRad(beta || 0);
    let gammaRad = THREE.MathUtils.degToRad(gamma || 0);

    if (Math.abs(window.orientation) === 90) gammaRad = -gammaRad;

    // iOS — sem yaw real (estimado)
    if (this.isIOS) {
      if (this.lastGamma !== null) {
        let deltaYaw = gammaRad - this.lastGamma;

        if (deltaYaw > Math.PI) deltaYaw -= 2 * Math.PI;
        if (deltaYaw < -Math.PI) deltaYaw += 2 * Math.PI;

        this.yawAccum += deltaYaw * 0.8;
      }
      this.lastGamma = gammaRad;

      const euler = new THREE.Euler(betaRad, this.yawAccum, -gammaRad, 'YXZ');
      this.target.setFromEuler(euler);
    }

    // Android — yaw real com filtro Kalman
    else {
      const rawAlpha = THREE.MathUtils.degToRad(alpha);
      const filteredAlpha = this._kalmanFilter(rawAlpha);

      if (this.lastAlpha !== null) {
        let delta = filteredAlpha - this.lastAlpha;

        // Corrige passagem 0° ↔ 360°
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;

        // Reduz apenas microtremores
        if (Math.abs(delta) < THREE.MathUtils.degToRad(0.1)) delta *= 0.2;

        // Soma ao yaw acumulado (permite giro 360° contínuo)
        this.yawAccum += delta;
      }

      this.lastAlpha = filteredAlpha;

      const euler = new THREE.Euler(
        betaRad,
        this.yawAccum,
        -gammaRad,
        'YXZ'
      );

      this.target.setFromEuler(euler);
    }

    // Ajustes de sistema de coordenadas
    this.target.multiply(this.q1);
    this.target.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient)
    );

    // Suavização com SLERP (interpolação esférica)
    const angle = this.smoothed.angleTo(this.target);

    if (angle > this.minMovement) {
      this.smoothed.slerp(this.target, this.slerpFactor);
    }

    this.camera.quaternion.copy(this.smoothed);
  }

  // Reset de referência
  resetOrientation() {
    this.yawAccum = 0;
    this.lastAlpha = null;
    this.lastGamma = null;
    this.alphaOffset = 0;

    this.kalman = { q: 0.01, r: 0.03, x: 0, p: 1, k: 0 };
    this.smoothed.copy(this.camera.quaternion);

    console.log(this.isIOS ? 'iOS: modo estimado ativo' : 'Android: modo Kalman ativo');
  }
}

export { DeviceOrientationCamera };