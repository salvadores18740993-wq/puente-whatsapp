const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const POCKETBASE_URL = 'https://pocketbase-production-1467.up.railway.app';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EVOLUTION_URL = 'https://latest-evolution-api-production-dd74.up.railway.app';
const EVOLUTION_KEY = 'FDA03F3B8BA3-4D57-8039-1B6F3F53D890'; // Tu API Key de Evolution

// ==================== ⚙️ CONFIGURA TUS DATOS DE PAGO MÓVIL ====================
const DATOS_PAGO_MOVIL = `
💳 *Datos para Pago Móvil:*
Banco: Banesco (0134)
Teléfono: 0414-0000000
RIF/Cédula: V-00000000
`;
// =============================================================================

const CATALOGO = `
- Harina P.A.N. ($2.00)
- Agua 50 ml ($2.00)
- Harina de trigo Mary ($1.50)
`;

// ==================== FUNCIONES AUXILIARES ====================

async function enviarMensajeWhatsApp(numero, texto) {
    try {
        await axios.post(`${EVOLUTION_URL}/message/sendText/pos-bot`, {
            number: numero,
            text: texto
        }, {
            headers: { 'apikey': EVOLUTION_KEY }
        });
        console.log('📤 Mensaje enviado a', numero);
    } catch (e) {
        console.error('❌ Error al enviar WhatsApp:', e.message);
    }
}

async function getSession(phone) {
    try {
        const res = await axios.get(`${POCKETBASE_URL}/api/collections/chat_sessions/records?filter=(phone='${phone}')`);
        return res.data.items.length > 0 ? res.data.items[0] : null;
    } catch (e) { return null; }
}

async function saveSession(id, data) {
    try {
        if (id) {
            await axios.patch(`${POCKETBASE_URL}/api/collections/chat_sessions/records/${id}`, data);
        } else {
            await axios.post(`${POCKETBASE_URL}/api/collections/chat_sessions/records`, data);
        }
    } catch (e) { console.error('Error guardando sesión:', e.message); }
}

// ==================== WEBHOOK ====================

app.get('/', (req, res) => res.send('Bot POS con IA ✅'));

app.post('/webhook', async (req, res) => {
    const data = req.body;
    if (data.event !== 'messages.upsert') return res.status(200).send('OK');
    if (!data.data || !data.data.key || data.data.key.fromMe === true) return res.status(200).send('OK');

    const msg = data.data;
    const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    const remitente = msg.key.remoteJid || '';
    const nombre = msg.pushName || 'Cliente';
    const telefono = remitente.split('@')[0];

    console.log(`\n📩 De ${nombre} (${telefono}): "${texto}"`);

    try {
        const session = await getSession(telefono);
        let state = session ? session.state : 'nuevo';
        let orderId = session ? session.orderId : null;
        let extraData = session ? session.extraData : '';

        // ----- FLUJO SEGÚN ESTADO -----

        if (state === 'nuevo' || !session) {
            // 1. Interpretar el pedido con IA
            const prompt = `Eres un asistente. Productos:\n${CATALOGO}\n\nCliente: "${texto}"\n\nResponde solo JSON: {"items": [{"name": "...", "quantity": 1, "price": 2.00}], "total": 2.00}. Si no es un pedido: {"error": "no_pedido"}`;
            const ai = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`, { contents: [{ parts: [{ text: prompt }] }] });
            const respuesta = ai.data.candidates[0].content.parts[0].text.trim();
            const jsonMatch = respuesta.match(/\{.*\}/s);
            const pedido = JSON.parse(jsonMatch[0]);

            if (pedido.error) {
                await enviarMensajeWhatsApp(telefono, `Hola ${nombre} 👋 ¿En qué podemos ayudarte?`);
                return res.status(200).send('OK');
            }

            // 2. Crear el pedido
            const nuevoPedido = await axios.post(`${POCKETBASE_URL}/api/collections/orders/records`, {
                orderNumber: 'WA-' + Date.now().toString().slice(-6),
                customerName: nombre,
                customerPhone: telefono,
                items: JSON.stringify(pedido.items),
                totalUsd: pedido.total,
                totalBs: pedido.total * 874.73,
                method: 'efectivo',
                status: 'pendiente',
                notes: 'Pedido WhatsApp',
                date: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
                timestamp: new Date().toISOString()
            });
            orderId = nuevoPedido.data.id;
            console.log('✅ Pedido creado:', orderId);

            // 3. Guardar sesión en espera de dirección
            if (session) {
                await saveSession(session.id, { state: 'esperando_direccion', orderId: orderId, extraData: '' });
            } else {
                await saveSession(null, { phone: telefono, state: 'esperando_direccion', orderId: orderId, extraData: '' });
            }

            // 4. Enviar saludo y pedir dirección
            await enviarMensajeWhatsApp(telefono, `¡Hola ${nombre}! 👋 Gracias por tu pedido.\n\n📍 Por favor, envíanos tu *dirección de entrega* para continuar.`);

        } else if (state === 'esperando_direccion') {
            // Guardar dirección y pedir método de pago
            await axios.patch(`${POCKETBASE_URL}/api/collections/orders/records/${orderId}`, {
                notes: `Dirección: ${texto}`
            });
            await saveSession(session.id, { state: 'esperando_metodo', extraData: texto });

            await enviarMensajeWhatsApp(telefono, `Perfecto ✅\n\n¿Cómo deseas pagar?\n\n1️⃣ *Pago Móvil*\n2️⃣ *Efectivo* (al recibir)\n\nResponde con el número o el nombre.`);

        } else if (state === 'esperando_metodo') {
            const eleccion = texto.toLowerCase();
            if (eleccion.includes('1') || eleccion.includes('movil') || eleccion.includes('móvil')) {
                await saveSession(session.id, { state: 'esperando_referencia' });
                await enviarMensajeWhatsApp(telefono, `${DATOS_PAGO_MOVIL}\n\nPor favor, envía el *número de referencia* cuando realices el pago.`);
            } else if (eleccion.includes('2') || eleccion.includes('efectivo')) {
                await axios.patch(`${POCKETBASE_URL}/api/collections/orders/records/${orderId}`, { method: 'efectivo' });
                await saveSession(session.id, { state: 'completado' });
                await enviarMensajeWhatsApp(telefono, `✅ Perfecto. Tu pedido se pagará en *efectivo* al recibir.\n\n¡Gracias por tu compra! Tu pedido ya está en preparación. 🛵`);
            } else {
                await enviarMensajeWhatsApp(telefono, `No entendí tu opción. Responde *1* para Pago Móvil o *2* para Efectivo.`);
            }

        } else if (state === 'esperando_referencia') {
            // Guardar la referencia
            await axios.patch(`${POCKETBASE_URL}/api/collections/orders/records/${orderId}`, {
                method: 'pagomovil',
                extra: JSON.stringify({ ref: texto.slice(-4) })
            });
            await saveSession(session.id, { state: 'completado' });
            await enviarMensajeWhatsApp(telefono, `✅ Referencia recibida. ¡Gracias por tu compra! Tu pedido ya está en preparación. 🛵`);

        } else {
            await enviarMensajeWhatsApp(telefono, `Gracias por escribirnos. Tu pedido ya está siendo procesado. 😊`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) console.error('Respuesta:', JSON.stringify(error.response.data));
    }

    res.status(200).send('OK');
});

// ==================== NOTIFICACIÓN CUANDO SE DESPACHA ====================

app.post('/notify-despachado', async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).send('Falta orderId');
    try {
        const r = await axios.get(`${POCKETBASE_URL}/api/collections/orders/records/${orderId}`);
        const pedido = r.data;
        const mensaje = `🛵 ¡Buenas noticias ${pedido.customerName}!\n\nTu pedido *#${pedido.orderNumber}* va en camino. 🚀\n\n¡Gracias por tu compra!`;
        await enviarMensajeWhatsApp(pedido.customerPhone, mensaje);
        res.status(200).send('OK');
    } catch (e) {
        console.error('Error notificando despacho:', e.message);
        res.status(500).send('Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot escuchando en puerto ${PORT}`));
