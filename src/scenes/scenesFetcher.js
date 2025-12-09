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
        if (cenasCarregadas.has(idCena)) return null;
        cenasCarregadas.add(idCena);

        // Puxando dados da cena incluindo as novas colunas de posição
        const { data: cena, error: erroCena } = await supabase
            .from('cenas')
            .select(`
                id, 
                caminho_imagem, 
                descricao,
                entrada_rotacao_y, 
                entrada_rotacao_pitch, 
                entrada_rotacao_roll, 
                offset_roll,
                texto,
                pos_x,
                pos_y,
                pos_z
            `)
            .eq('id', idCena)
            .single();

        if (erroCena) throw new Error(`Erro ao carregar cena ${idCena}: ${erroCena.message}`);

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

        if (erroHotspots) throw new Error(`Erro ao carregar hotspots: ${erroHotspots.message}`);

        const hotspotsComDestinos = await Promise.all(
            hotspots.map(async (hotspot) => {
                const destinoId = hotspot.cena_destino?.id;
                const cenaDestinoCompleta = destinoId && !cenasCarregadas.has(destinoId)
                    ? await carregarTodasAsCenas(destinoId, cenasCarregadas)
                    : null;

                return {
                    name: hotspot.descricao,
                    target: hotspot.cena_destino ? `panorama${hotspot.cena_destino.id}` : null,
                    icon: hotspot.icon || 'bolaHots.png',
                    pos_x: hotspot.pos_x,
                    pos_y: hotspot.pos_y,
                    pos_z: hotspot.pos_z,
                    entrada_rotacao_y: hotspot.yaw ? THREE.MathUtils.degToRad(hotspot.yaw) : (hotspot.entrada_rotacao_y ? THREE.MathUtils.degToRad(hotspot.entrada_rotacao_y) : 0),
                    entrada_rotacao_pitch: hotspot.pitch ? THREE.MathUtils.degToRad(hotspot.pitch) : 0,
                    entrada_rotacao_roll: hotspot.roll ? THREE.MathUtils.degToRad(hotspot.roll) : 0,
                    cena_destino: cenaDestinoCompleta,
                    texto: hotspot.texto
                };
            })
        );

        // Mapeia os dados da cena para o formato esperado pelo Three.js
        const cenaData = {
            id: cena.id,
            image: cena.caminho_imagem,
            descricao: cena.descricao,
            entrada_rotacao_y: cena.entrada_rotacao_y ? THREE.MathUtils.degToRad(cena.entrada_rotacao_y) : 0,
            entrada_rotacao_pitch: cena.entrada_rotacao_pitch ? THREE.MathUtils.degToRad(cena.entrada_rotacao_pitch) : 0,
            entrada_rotacao_roll: cena.entrada_rotacao_roll ? THREE.MathUtils.degToRad(cena.entrada_rotacao_roll) : 0,
            offset_roll: cena.offset_roll ? THREE.MathUtils.degToRad(cena.offset_roll) : 0,
            pos_x: cena.pos_x,
            pos_y: cena.pos_y,
            pos_z: cena.pos_z,
            hotspots: hotspotsComDestinos.filter(h => h !== null),
            captureHeight: 1.6,
            textoCena: cena.texto 
        };

        // Se a cena tiver texto, criamos um hotspot especial para a legenda da cena
        if (cena.texto) {
            
            const legendaHotspot = {
                name: `${cena.descricao}`, // Nome para identificação
                target: null,
                icon: null, // Sem ícone
                pos_x: cena.pos_x || 0, // Usa posição da cena se disponível, senão padrão
                pos_y: (cena.pos_y || 1.6) + 0.5, // Acima da posição da cena
                pos_z: cena.pos_z || -2,
                entrada_rotacao_y: 0,
                entrada_rotacao_pitch: 0,
                entrada_rotacao_roll: 0,
                texto: cena.texto,
                isLegenda: true,
                tipo: 'textoCena' 
            };
            cenaData.hotspots.push(legendaHotspot);
        }
        return cenaData;

    } catch (error) {
        console.error(`Erro em carregarTodasAsCenas(${idCena}):`, error);
        throw error;
    }
}