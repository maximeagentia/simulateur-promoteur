// api/airtable.js — EstimationTerrain.fr
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Parser le body manuellement (Vercel ne le fait pas automatiquement)
  let body = {};
  try {
    if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else {
      // Lire le stream
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      body = raw ? JSON.parse(raw) : {};
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE  = process.env.AIRTABLE_BASE_ID || 'applqQPw8cx2pQ8NA';
  const TABLE = process.env.AIRTABLE_TABLE_ID || 'tblzP5PQSTBj4B8LI';
  if (!TOKEN) {
    console.warn('[airtable] AIRTABLE_TOKEN non configuré — écriture ignorée');
    return res.status(200).json({ ok: true, mode: 'dev_no_airtable' });
  }
  const recordId = body._recordId || null;

  // Champs — noms simples, cohérents avec la table Airtable
  const fields = {};
  if (body.type)            fields['Type']           = String(body.type);
  if (body.adresse)         fields['Adresse']        = String(body.adresse);
  if (body.surface)         fields['Surface']        = Number(body.surface);
  if (body.cadastre)        fields['Cadastre']       = String(body.cadastre);
  if (body.zone_plu)        fields['Zone PLU']       = String(body.zone_plu);
  if (body.shab_nette)      fields['SHAB nette']     = Number(body.shab_nette);
  if (body.ca_ttc)          fields['CA TTC']         = Number(body.ca_ttc);
  if (body.cout_travaux)    fields['Cout travaux']   = Number(body.cout_travaux);
  if (body.marge_promoteur) fields['Marge promo']    = Number(body.marge_promoteur);
  if (body.charge_fonciere) fields['Charge fonciere']= Number(body.charge_fonciere);
  if (body.ratio_cf)        fields['Ratio CF CA']    = Number(body.ratio_cf);
  if (body.prix_marche)     fields['Prix marche DVF']= Number(body.prix_marche);
  if (body.val_low)         fields['Val low']        = Number(body.val_low);
  if (body.val_high)        fields['Val high']       = Number(body.val_high);
  if (body.val_low && body.val_high) {
    fields['Fourchette'] = `${Math.round(body.val_low/1000)}K - ${Math.round(body.val_high/1000)}K EUR`;
  }
  if (body.score)           fields['Score']          = Number(body.score);
  if (body.prenom)          fields['prenom']         = String(body.prenom);
  if (body.nom)             fields['Nom']            = String(body.nom);
  if (body.email)           fields['E-mail']         = String(body.email);
  if (body.tel)             fields['Tel']            = String(body.tel);
  fields['Date'] = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    const url = recordId
      ? `https://api.airtable.com/v0/${BASE}/${TABLE}/${recordId}`
      : `https://api.airtable.com/v0/${BASE}/${TABLE}`;
    const r = await fetch(url, {
      method: recordId ? 'PATCH' : 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('[airtable] Error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Airtable error', detail: data });
    }
    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('[airtable] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
