const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// URL de tu PocketBase en Railway
const POCKETBASE_URL = 'https://pocketbase-production-1467.up.railway.app';

// Ruta raíz para verificar que el servidor está vivo
app.get('/', (req, res) => {
    res.send('Puente WhatsApp-POS funcionando correctamente ✅');
});

// Ruta que recibe los mensajes de Evolution API
app.post('/webhook', async (req, res) => {
    const data = req.body;
    console.log('=== MENSAJE RECIBIDO ===');
    console.log(JSON.stringify(data, null, 2));

    // Detectar si es un mensaje nuevo que NO sea nuestro
    const esMensajeNuevo = data.event === 'messages.upsert';
    const noEsMio = data.data && data.data.key && data.data.key.fromMe === false;

    if (esMensajeNuevo && noEsMio) {
        const msg = data.data;
        const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const remitente = msg.key.remoteJid || '';
        const nombre = msg.pushName || 'Cliente WhatsApp';
        const telefono = remitente.split('@')[0];

        console.log('📩 Procesando pedido de:', nombre, '| Teléfono:', telefono, '| Texto:', texto);

        try {
            await axios.post(`${POCKETBASE_URL}/api/collections/orders/records`, {
                orderNumber: 'WA-' + Date.now().toString().slice(-6),
                customerName: nombre,
                customerPhone: telefono,
                items: JSON.stringify([{ name: texto, quantity: 1, price: 0 }]),
                totalUsd: 0,
                totalBs: 0,
                method: 'efectivo',
                status: 'pendiente',
                notes: 'Pedido recibido por WhatsApp',
                date: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
                timestamp: new Date().toISOString()
            });
            console.log('✅ Pedido creado exitosamente para:', nombre);
        } catch (error) {
            console.error('❌ Error al crear el pedido en PocketBase:');
            console.error('Mensaje:', error.message);
            if (error.response) {
                console.error('Respuesta del servidor:', JSON.stringify(error.response.data, null, 2));
            }
        }
    } else {
        console.log('⏭️  Evento ignorado (no es mensaje nuevo o es enviado por nosotros mismos).');
    }

    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
