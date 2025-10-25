import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gzurmfaahtfqhjkfojep.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function debugUsers() {
  console.log('🔍 Verificando status dos usuários...\n');

  // 1. Verificar todos os usuários
  console.log('1️⃣ TODOS OS USUÁRIOS:');
  console.log('=' .repeat(80));
  const { data: allUsers, error: usersError } = await supabase
    .from('users')
    .select('id, email, name, presence_status, last_active_at, created_at')
    .order('last_active_at', { ascending: false, nullsFirst: false });

  if (usersError) {
    console.error('❌ Erro ao buscar usuários:', usersError);
  } else if (allUsers) {
    for (const user of allUsers) {
      const minutesSinceActive = user.last_active_at 
        ? Math.round((Date.now() - new Date(user.last_active_at).getTime()) / 60000)
        : null;
      
      console.log(`\n👤 ${user.name || user.email}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Status: ${user.presence_status || 'null'}`);
      console.log(`   Last Active: ${user.last_active_at || 'null'} (${minutesSinceActive ? minutesSinceActive + ' min ago' : 'never'})`);
    }
  }

  // 2. Verificar usuários ONLINE (últimos 2 minutos)
  console.log('\n\n2️⃣ USUÁRIOS ONLINE (presence_status=online E last_active < 2min):');
  console.log('=' .repeat(80));
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: onlineUsers, error: onlineError } = await supabase
    .from('users')
    .select('id, email, name, presence_status, last_active_at')
    .eq('presence_status', 'online')
    .gte('last_active_at', twoMinutesAgo);

  if (onlineError) {
    console.error('❌ Erro ao buscar usuários online:', onlineError);
  } else if (onlineUsers && onlineUsers.length > 0) {
    for (const user of onlineUsers) {
      const minutesSinceActive = Math.round((Date.now() - new Date(user.last_active_at).getTime()) / 60000);
      console.log(`\n✅ ${user.name || user.email}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Last Active: ${user.last_active_at} (${minutesSinceActive} min ago)`);
    }
  } else {
    console.log('\n❌ NENHUM usuário online encontrado!');
    console.log('   Isso explica por que não há nearby users detectados.');
  }

  // 3. Verificar localizações recentes (últimos 5 minutos)
  console.log('\n\n3️⃣ LOCALIZAÇÕES RECENTES (últimos 5 minutos):');
  console.log('=' .repeat(80));
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: locations, error: locError } = await supabase
    .from('locations')
    .select('user_id, latitude, longitude, recorded_at, users!inner(email, name)')
    .gte('recorded_at', fiveMinutesAgo)
    .order('recorded_at', { ascending: false });

  if (locError) {
    console.error('❌ Erro ao buscar localizações:', locError);
  } else if (locations && locations.length > 0) {
    console.log(`\n✅ ${locations.length} localizações encontradas:`);
    
    // Group by user
    const byUser = new Map<string, any[]>();
    for (const loc of locations) {
      const userId = loc.user_id;
      if (!byUser.has(userId)) {
        byUser.set(userId, []);
      }
      byUser.get(userId)!.push(loc);
    }

    for (const [userId, locs] of byUser.entries()) {
      const user = locs[0].users;
      const minutesAgo = Math.round((Date.now() - new Date(locs[0].recorded_at).getTime()) / 60000);
      console.log(`\n📍 ${user.name || user.email}`);
      console.log(`   Localizações: ${locs.length}`);
      console.log(`   Última: ${locs[0].recorded_at} (${minutesAgo} min ago)`);
      console.log(`   Coordenadas: ${locs[0].latitude}, ${locs[0].longitude}`);
    }
  } else {
    console.log('\n❌ NENHUMA localização recente encontrada!');
    console.log('   Isso significa que o GPS NÃO está enviando dados para o backend.');
  }

  // 4. Contar localizações por usuário (últimos 10 minutos)
  console.log('\n\n4️⃣ CONTAGEM DE LOCALIZAÇÕES POR USUÁRIO (últimos 10 minutos):');
  console.log('=' .repeat(80));
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: locationCounts, error: countError } = await supabase
    .from('locations')
    .select('user_id, recorded_at, users!inner(email, name)')
    .gte('recorded_at', tenMinutesAgo);

  if (countError) {
    console.error('❌ Erro ao contar localizações:', countError);
  } else if (locationCounts) {
    const countsByUser = new Map<string, number>();
    for (const loc of locationCounts) {
      const userId = loc.user_id;
      countsByUser.set(userId, (countsByUser.get(userId) || 0) + 1);
    }

    console.log('\n');
    for (const [userId, count] of countsByUser.entries()) {
      const loc = locationCounts.find(l => l.user_id === userId);
      const user = loc?.users;
      console.log(`📊 ${user?.name || user?.email}: ${count} localizações`);
    }

    if (countsByUser.size === 0) {
      console.log('❌ Nenhuma localização nos últimos 10 minutos!');
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Debug completo!\n');
}

debugUsers().catch(console.error);
