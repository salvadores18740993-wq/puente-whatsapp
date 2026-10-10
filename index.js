const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// URL de tu PocketBase en Railway
const POCKETBASE_URL = 'https://pocketbase-production-1467.up.railway.app';

// Tu API Key de Gemini (se lee desde las variables de entorno de Render)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Catálogo de productos (ajústalo con tus productos reales)
const CATALOGO = `
- Harina P.A.N. ($2.00)
- Agua 50 ml ($2.00)
- Harina de trigo Mary ($1.50)
`;

// Ruta raíz para verificar que el servidor está vivo
app.get('/', (req, res) => {
    res.send('Puente WhatsApp-POS con IA funcionando correctamente ✅');
});

// Ruta que recibe los mensajes de Evolution API
app.post('/webhook', async (req, res) => {
    const data = req.body;

    const esMensajeNuevo = data.event === 'messages.upsert';
    const noEsMio = data.data && data.data.key && data.data.key.fromMe === false;

    if (esMensajeNuevo && noEsMio) {
        const msg = data.data;
        const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const remitente = msg.key.remoteJid || '';
        const nombre = msg.pushName || 'Cliente WhatsApp';
        const telefono = remitente.split('@')[0];

        console.log('📩 Mensaje recibido de:', nombre, '| Texto:', texto);

        try {
            // 1. Enviar el mensaje a Gemini para que lo interprete
            const prompt = `Eres un asistente de pedidos de una tienda. Estos son los productos disponibles:\n${CATALOGO}\n\nEl cliente dice: "${texto}"\n\nResponde ÚNICAMENTE con un JSON con este formato exacto: {"items": [{"name": "nombre del producto", "quantity": 1, "price": 2.00}], "total": 2.00}. Si no entiendes el pedido, responde: {"error": "No se entendió el pedido"}. No agregues texto adicional, solo el JSON.`;

            const geminiResponse = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`,
                {
                    contents: [{ parts: [{ text: prompt }] }]
                }
            );

            const respuestaIA = geminiResponse.data.candidates[0].content.parts[0].text.trim();
            console.log('🤖 Respuesta de Gemini:', respuestaIA);

            // 2. Extraer el JSON de la respuesta de la IA
            const jsonMatch = respuestaIA.match(/\{.*\}/s);
            if (!jsonMatch) {
                console.error('❌ La IA no devolvió un JSON válido.');
                return res.status(200).send('OK');
            }

            const pedido = JSON.parse(jsonMatch[0]);

            if (pedido.error) {
                console.error('❌ La IA no entendió el pedido:', pedido.error);
                return res.status(200).send('OK');
            }

            // 3. Crear el pedido en PocketBase con los datos estructurados
            await axios.post(`${POCKETBASE_URL}/api/collections/orders/records`, {
                orderNumber: 'WA-' + Date.now().toString().slice(-6),
                customerName: nombre,
                customerPhone: telefono,
                items: JSON.stringify(pedido.items),
                totalUsd: pedido.total,
                totalBs: pedido.total * 874.73,
                method: 'efectivo',
                status: 'pendiente',
                notes: 'Pedido procesado por IA',
                date: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
                timestamp: new Date().toISOString()
            });

            console.log('✅ Pedido creado exitosamente para:', nombre, '| Total:', pedido.total);

        } catch (error) {
            console.error('❌ Error al procesar el pedido:');
            console.error('Mensaje:', error.message);
            if (error.response) {
                console.error('Respuesta del servidor:', JSON.stringify(error.response.data, null, 2));
            }
        }
    } else {
        console.log('⏭️ Evento ignorado.');
    }

    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
