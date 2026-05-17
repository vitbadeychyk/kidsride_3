// Vercel Serverless Function: проксі до Нової Пошти.
// Ключ зберігається на сервері в env-змінній NP_API_KEY (можна також NOVAPOSHTA_API_KEY).
// Фронтенд надсилає сюди JSON виду:
//   { modelName, calledMethod, methodProperties }
// Ця функція додає apiKey і пересилає запит у https://api.novaposhta.ua/v2.0/json/

const NP_URL = 'https://api.novaposhta.ua/v2.0/json/';

// Прості ліміти/таймаути
const REQUEST_TIMEOUT_MS = 12000;

// Білий список методів НП — щоб ніхто не використав ваш ключ для довільних викликів
const ALLOWED = {
  Address: new Set([
    'getCities',
    'getAreas',
    'getSettlements',
    'searchSettlements',
    'searchSettlementStreets',
    'getStreet',
    'getWarehouses',
    'getWarehouseTypes',
  ]),
  AddressGeneral: new Set([
    'getCities',
    'getAreas',
    'getSettlements',
    'searchSettlements',
    'searchSettlementStreets',
    'getStreet',
    'getWarehouses',
    'getWarehouseTypes',
  ]),
  Common: new Set([
    'getTimeIntervals',
    'getCargoTypes',
    'getServiceTypes',
    'getTypesOfCounterparties',
    'getPaymentForms',
    'getOwnershipFormsList',
  ]),
  InternetDocument: new Set([
    'getDocumentPrice',
    'getDocumentDeliveryDate',
  ]),
  TrackingDocument: new Set([
    'getStatusDocuments',
  ]),
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, errors: ['Method not allowed'] });
  }

  const apiKey = process.env.NP_API_KEY || process.env.NOVAPOSHTA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      success: false,
      errors: ['NP_API_KEY не задано у змінних середовища Vercel'],
    });
  }

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const modelName = String(body.modelName || '').trim();
    const calledMethod = String(body.calledMethod || '').trim();
    const methodProperties = (body.methodProperties && typeof body.methodProperties === 'object')
      ? body.methodProperties
      : {};

    if (!modelName || !calledMethod) {
      return res.status(400).json({
        success: false,
        errors: ['modelName та calledMethod є обовʼязковими'],
      });
    }

    if (!ALLOWED[modelName] || !ALLOWED[modelName].has(calledMethod)) {
      return res.status(400).json({
        success: false,
        errors: [`Метод ${modelName}.${calledMethod} не дозволений`],
      });
    }

    // Захист від занадто великих payload-ів
    try {
      const payloadSize = JSON.stringify(methodProperties).length;
      if (payloadSize > 10000) {
        return res.status(413).json({
          success: false,
          errors: ['methodProperties занадто великий'],
        });
      }
    } catch {}

    const upstreamBody = {
      apiKey,
      modelName,
      calledMethod,
      methodProperties,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let upstream;
    try {
      upstream = await fetch(NP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(upstreamBody),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (e?.name === 'AbortError') {
        return res.status(504).json({
          success: false,
          errors: ['Нова Пошта не відповіла вчасно'],
        });
      }
      return res.status(502).json({
        success: false,
        errors: ['Помилка звернення до Нової Пошти: ' + (e?.message || 'unknown')],
      });
    }
    clearTimeout(timeoutId);

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        success: false,
        errors: ['Невалідна відповідь від Нової Пошти'],
        raw: text?.slice(0, 500),
      });
    }

    // Невелике кешування на CDN, щоб не спалювати квоту на повторюваних запитах
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    return res.status(upstream.ok ? 200 : upstream.status).json(data);
  } catch (e) {
    return res.status(500).json({
      success: false,
      errors: [e?.message || 'Server error'],
    });
  }
}
