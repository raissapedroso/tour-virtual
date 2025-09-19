import { createClient } from '@supabase/supabase-js';
import * as THREE from 'three';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Variáveis de ambiente Supabase não configuradas corretamente');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export async function carregarTodasAsCenas(idCena, cenasCarregadas = new Set()) {
    try {
        idCena = Number(idCena);
        if (cenasCarregadas.has(idCena)) {
            return null;
        }
        cenasCarregadas.add(idCena);

        // Adicione ', capture_height' aqui se a coluna existir no banco
        const { data: cena, error: erroCena } = await supabase
            .from('cenas')
            .select('id, caminho_imagem, entrada_rotacao_y, entrada_rotacao_pitch, entrada_rotacao_roll') // Adicione capture_height se disponível
            .eq('id', idCena)
            .single();

        if (erroCena) {
            console.error(`Erro ao carregar cena ${idCena}:`, erroCena.message);
            throw new Error(`Erro ao carregar cena ${idCena}: ${erroCena.message}`);
        }
        console.log(`Precarregando textura - ID: ${cena.id}, Imagem: ${cena.image}`);

        const { data: hotspots, error: erroHotspots } = await supabase
            .from('hotspots')
            .select(`
                id,
                descricao,
                pos_x,
                pos_y,
                pos_z,
                entrada_rotacao_y,
                yaw,
                pitch,
                roll,
                cena_destino (
                    id,
                    caminho_imagem,
                    descricao
                )
            `)
            .eq('cena_origem', idCena);

        if (erroHotspots) {
            console.error(`Erro ao carregar hotspots para cena ${idCena}:`, erroHotspots.message);
            throw new Error(`Erro ao carregar hotspots: ${erroHotspots.message}`);
        }

        if (hotspots.length === 0) {
            console.warn(`Nenhum hotspot encontrado para cena ${idCena}`);
        }

        const hotspotsComDestinos = await Promise.all(
            hotspots.map(async (hotspot) => {
                try {
                    const destinoId = hotspot.cena_destino?.id;
                    const cenaDestinoCompleta = destinoId && !cenasCarregadas.has(destinoId)
                        ? await carregarTodasAsCenas(destinoId, cenasCarregadas)
                        : null;

                    return {
                        name: hotspot.descricao,
                        target: hotspot.cena_destino ? `panorama${hotspot.cena_destino.id}` : null,
                        icon: 'bolaHots.png', // Assumindo um ícone padrão
                        pos_x: hotspot.pos_x,
                        pos_y: hotspot.pos_y,
                        pos_z: hotspot.pos_z,
                        entrada_rotacao_y: hotspot.yaw ? THREE.MathUtils.degToRad(hotspot.yaw) : (hotspot.entrada_rotacao_y ? THREE.MathUtils.degToRad(hotspot.entrada_rotacao_y) : 0),
                        entrada_rotacao_pitch: hotspot.pitch ? THREE.MathUtils.degToRad(hotspot.pitch) : 0,
                        entrada_rotacao_roll: hotspot.roll ? THREE.MathUtils.degToRad(hotspot.roll) : 0,
                        cena_destino: cenaDestinoCompleta
                    };
                } catch (error) {
                    console.error(`Erro ao processar hotspot ${hotspot.id}:`, error);
                    return null;
                }
            })
        );

        return {
            id: cena.id,
            image: cena.caminho_imagem,
            entrada_rotacao_y: cena.entrada_rotacao_y ? THREE.MathUtils.degToRad(cena.entrada_rotacao_y) : 0,
            entrada_rotacao_pitch: cena.entrada_rotacao_pitch ? THREE.MathUtils.degToRad(cena.entrada_rotacao_pitch) : 0,
            entrada_rotacao_roll: cena.entrada_rotacao_roll ? THREE.MathUtils.degToRad(cena.entrada_rotacao_roll) : 0,
            hotspots: hotspotsComDestinos.filter(h => h !== null),
            captureHeight: cena.capture_height || 1.2  // Default 1.2m (ajuste ou adicione coluna no banco)
        };
    } catch (error) {
        console.error(`Erro em carregarTodasAsCenas(${idCena}):`, error);
        throw error;
    }
}