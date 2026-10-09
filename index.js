const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// URL de tu PocketBase en Railway
const POCKETBASE_URL = 'https://pocketbase-production-1467.up.railway.app';

app.post('/webhook', async (req, res) => {
    const data = req.body;
    console.log('Mensaje recibido:', data);

    // Verificar que sea un mensaje nuevo y que NO sea enviado por nosotros mismos
    if (data.evento === 'mensajes.upsert' && data.datos && data.datos.key.fromMe === false) {
        const msg = data.datos;
        const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const remitente = msg.key.remoteJid;
        const nombre = msg.pushName || 'Cliente WhatsApp';
        const telefono = remitente.split('@')[0];

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
            console.error('❌ Error al crear el pedido:', error.message);
        }
    }

    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});