import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Variáveis de ambiente Supabase não configuradas corretamente');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export async function carregarTodasAsCenas(idCena, cenasCarregadas = new Set()) {
    idCena = Number(idCena);
    if (cenasCarregadas.has(idCena)) {
        return null;
    }
    cenasCarregadas.add(idCena);

    const { data: cena, error: erroCena } = await supabase
        .from('cenas')
        .select('*')
        .eq('id', idCena)
        .single();

    if (erroCena) {
        console.error('Erro ao carregar cena:', erroCena.message);
        return null;
    }

    const { data: hotspots, error: erroHotspots } = await supabase
        .from('hotspots')
        .select(`
            id,
            descricao,
            pos_x,
            pos_y,
            pos_z,
            cena_destino (
                id,
                caminho_imagem,
                descricao
            )
        `)
        .eq('cena_origem', idCena);

    if (erroHotspots) {
        console.error('Erro ao carregar hotspots:', erroHotspots.message);
        return null;
    }

    if (hotspots.length === 0) {
        console.warn(`Nenhum hotspot encontrado para cena ${idCena}`);
    }


    const hotspotsComDestinos = await Promise.all(
        hotspots.map(async (hotspot) => {
            const cenaDestinoCompleta = hotspot.cena_destino?.id
                ? await carregarTodasAsCenas(hotspot.cena_destino.id, cenasCarregadas)
                : null;

            return {
                name: hotspot.descricao,
                target: hotspot.cena_destino ? `panorama${hotspot.cena_destino.id}` : null,
                icon: 'click.png',
                pos_x: hotspot.pos_x,
                pos_y: hotspot.pos_y,
                pos_z: hotspot.pos_z,
                cena_destino: cenaDestinoCompleta
            };
        })
    );

    return {
        id: cena.id,
        image: cena.caminho_imagem,
        hotspots: hotspotsComDestinos,
    };
}
