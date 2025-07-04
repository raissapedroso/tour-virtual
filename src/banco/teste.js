import dotenv from 'dotenv';

dotenv.config();

import {createClient} from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

async function carregarCenaComHotspotsRecursivo(idCena, cenasCarregadas = new Set()) {
    if (cenasCarregadas.has(idCena)) {
        // Evita loop
        return null;
    }
    cenasCarregadas.add(idCena);

    // 1. Buscar a cena principal
    const {data: cena, error: erroCena} = await supabase
        .from('cenas')
        .select('*')
        .eq('id', idCena)
        .single();

    if (erroCena) {
        console.error('Erro ao carregar cena:', erroCena.message);
        return null;
    }

    // 2. Buscar os hotspots ligados a essa cena
    const {data: hotspots, error: erroHotspots} = await supabase
        .from('hotspots')
        .select(`
          id,
          descricao,
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

    // 3. Para cada hotspot, carregar recursivamente os hotspots da cena_destino
    const hotspotsComDestinos = await Promise.all(
        hotspots.map(async (hotspot) => {
            if (hotspot.cena_destino?.id) {
                const cenaDestinoCompleta = await carregarCenaComHotspotsRecursivo(hotspot.cena_destino.id, cenasCarregadas);
                return {
                    ...hotspot,
                    cena_destino: cenaDestinoCompleta
                };
            }
            return hotspot;
        })
    );

    // 4. Retorna a cena com os hotspots completos
    return {
        ...cena,
        hotspots: hotspotsComDestinos
    };
}

// Chamada para testar
carregarCenaComHotspotsRecursivo(1).then(cenaCompleta => {
    console.log(JSON.stringify(cenaCompleta, null, 2));
});

