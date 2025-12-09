import dotenv from 'dotenv';

dotenv.config();

import {createClient} from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

async function carregarCenaComHotspots(idCena) {
    // 1. Buscar a cena principal
    const {data: cena, error: erroCena} = await supabase
        .from('cenas')
        .select('*')
        .eq('id', idCena)
        .single();

    if (erroCena) {
        console.error('Erro ao carregar cena:', erroCena.message);
        return;
    }

    // 2. Buscar os hotspots ligados a essa cena, com os dados da cena_destino
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
        return;
    }

    // Exibir o resultado
    console.log('🎬 Cena atual:', cena);
    console.log('🧭 Hotspots com destinos:', hotspots);
}

carregarCenaComHotspots(1); // ou qualquer outro ID de cena
