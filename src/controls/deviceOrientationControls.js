import * as THREE from 'three';
import { Euler, EventDispatcher, MathUtils, Quaternion, Vector3 } from 'three';


const _zee = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();

const _q1 = new Quaternion( - Math.sqrt( 0.5 ), 0, 0, Math.sqrt( 0.5 ) ); // - PI/2 around the x-axis

const _changeEvent = { type: 'change' };

class DeviceOrientationControls extends THREE.EventDispatcher {
    constructor(object) {
        super();

        const scope = this;

        if (window.isSecureContext === false) {
            console.error('DeviceOrientationControls: Use HTTPS for sensor access.');
        }

        const EPS = 0.000001;
        const lastQuaternion = new THREE.Quaternion();

        this.object = object;
        this.object.rotation.reorder('YXZ');

        this.enabled = true;

        this.deviceOrientation = {};
        this.screenOrientation = 0;

        this.alphaOffset = 0;

        const _zee = new THREE.Vector3(0, 0, 1);
        const _euler = new THREE.Euler();
        const _q0 = new THREE.Quaternion();
        const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

        const _changeEvent = { type: 'change' };

        const onDeviceOrientationChangeEvent = function (event) {
            scope.deviceOrientation = event;
        };

        const onScreenOrientationChangeEvent = function () {
            scope.screenOrientation = window.orientation || 0;
        };

        const setObjectQuaternion = function (quaternion, alpha, beta, gamma, orient) {
            _euler.set(beta, alpha, -gamma, 'YXZ');
            quaternion.setFromEuler(_euler);
            quaternion.multiply(_q1);
            quaternion.multiply(_q0.setFromAxisAngle(_zee, -orient));
        };

        this.connect = function () {
            onScreenOrientationChangeEvent();

            if (
                window.DeviceOrientationEvent !== undefined &&
                typeof window.DeviceOrientationEvent.requestPermission === 'function'
            ) {
                window.DeviceOrientationEvent.requestPermission().then(function (response) {
                    if (response === 'granted') {
                        window.addEventListener('orientationchange', onScreenOrientationChangeEvent);
                        window.addEventListener('deviceorientation', onDeviceOrientationChangeEvent);
                    }
                }).catch(function (error) {
                    console.error('DeviceOrientationControls: Permission error.', error);
                });
            } else {
                window.addEventListener('orientationchange', onScreenOrientationChangeEvent);
                window.addEventListener('deviceorientation', onDeviceOrientationChangeEvent);
            }

            scope.enabled = true;
        };

        this.disconnect = function () {
            window.removeEventListener('orientationchange', onScreenOrientationChangeEvent);
            window.removeEventListener('deviceorientation', onDeviceOrientationChangeEvent);
            scope.enabled = false;
        };

        this.update = function () {
            if (scope.enabled === false) return;

            const device = scope.deviceOrientation;

            if (device) {
                const alpha = device.alpha ? THREE.MathUtils.degToRad(device.alpha) + scope.alphaOffset : 0;
                const beta = device.beta ? THREE.MathUtils.degToRad(device.beta) : 0;
                const gamma = device.gamma ? THREE.MathUtils.degToRad(device.gamma) : 0;
                const orient = scope.screenOrientation ? THREE.MathUtils.degToRad(scope.screenOrientation) : 0;

                setObjectQuaternion(scope.object.quaternion, alpha, beta, gamma, orient);

                if (8 * (1 - lastQuaternion.dot(scope.object.quaternion)) > EPS) {
                    lastQuaternion.copy(scope.object.quaternion);
                    scope.dispatchEvent(_changeEvent);
                }
            }
        };

        this.dispose = function () {
            scope.disconnect();
        };

        this.connect();
    }
}

export { DeviceOrientationControls };
