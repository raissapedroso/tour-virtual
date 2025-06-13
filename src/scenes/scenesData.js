//Aqui estão todas as cenas do tour virtual com suas respectivas imagens
export const scenesData = {
    //panorama0: Entrada da faculdade
    panorama0: {
        image: 'Pampa3.jpg',
        hotspots: [
            {
                name: 'Ir para Corredor',
                target: 'panorama1',
                position: {x: -48, y: 0, z: 10},
                icon: 'click.png'
            }
        ]
    },
    //panorama1: Entrada da faculdade dentro do portão
    panorama1: {
        image: 'Pampa1.jpg',
        hotspots: [
            {
                name: 'Ir para o Saguão',
                target: 'panorama2',
                position: {x: -8, y: -1, z: -35},
                icon: 'click.png'
            },
            {
                name: 'Ir para Corredor',
                target: 'panorama3',
                position: {x: -15, y: 0, z: 10},
                icon: 'click.png'
            },
            {
                name: 'Ir para Corredor',
                target: 'panorama0',
                position: {x: 45, y: 0, z: 10},
                icon: 'click.png'
            }
        ]
    },
    panorama2: {
        image: 'Pampa2.jpg',
        hotspots: [
            {
                name: 'Voltar para Sala 1',
                target: 'panorama1',
                position: {x: -37, y: 4, z: -25},
                icon: 'click.png'
            }
        ]
    },
    //panorama3: Pátio da faculdade
    panorama3: {
        image: 'Pampa4.jpg',
        hotspots: [
            {
                name: 'Voltar para Sala 1',
                target: 'panorama1',
                position: {x: 23, y: 0, z: -25},
                icon: 'click.png'
            },
            {
                name: 'Indo para o segundo predio',
                target: 'panorama4',
                position: {x: -25, y: 0, z: 35},
                icon: 'click.png'
            }
        ]
    },
    panorama4: {
        image: 'Pampa5.jpg',
        hotspots: [
            {
                name: 'Voltar para Sala 1',
                target: 'panorama5',
                position: {x: -35, y: 0, z: -5},
                icon: 'click.png'
            },
            {
                name: 'Indo para o segundo predio',
                target: 'panorama3',
                position: {x: 22, y: -1, z: 25},
                icon: 'click.png'
            }
        ]
    },
    panorama5: {
        image: 'Pampa6.jpg',
        hotspots: [
            {
                name: 'Voltar para Sala 1',
                target: 'panorama1',
                position: {x: -35, y: 0, z: -5},
                icon: 'click.png'
            },
        ]
    },
};