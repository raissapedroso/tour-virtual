export const scenesData = {
    panorama1: {
        image: 'Pampa.jpg',
        hotspots: [
            {
                name: 'Ir para o Saguão',
                target: 'panorama2',
                position: {x: 10, y: 0, z: -30}
            },
            {
                name: 'Ir para Corredor',
                target: 'panorama1',
                position: {x: -15, y: 0, z: 20}
            }
        ]
    },
    panorama2: {
        image: 'Pampa2.jpg',
        hotspots: [
            {
                name: 'Voltar para Sala 1',
                target: 'panorama1',
                position: {x: 5, y: 0, z: -25}
            }
        ]
    },
};