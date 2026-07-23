# IAsapre WhatsApp Bot

Este es el backend real en Node.js para conectar el sistema de devoluciones a un número de WhatsApp real mediante un Código QR.

## Requisitos

1. Tener instalado [Node.js](https://nodejs.org/).

## Instrucciones para Iniciarlo

Abre una terminal (o consola de comandos) en esta carpeta (`iasapre-bot`) y ejecuta:

1. **Instalar las dependencias:**
   ```bash
   npm install
   ```

2. **Iniciar el bot:**
   ```bash
   npm start
   ```

## ¿Qué pasará cuando lo inicies?

1. Verás en tu consola un gran **Código QR**.
2. Abre la app de WhatsApp en el celular que quieras usar como Bot.
3. Ve a **Dispositivos vinculados > Vincular un dispositivo** y escanea el código QR de tu pantalla.
4. ¡Listo! El terminal dirá "✅ Bot conectado". 
5. Desde OTRO celular, escríbele "Hola" al número del bot y verás cómo responde automáticamente pidiendo el nombre del ejecutivo.

## Panel de Administración

Mientras el bot esté corriendo en la consola, puedes abrir tu navegador y visitar:
👉 **http://localhost:3000**

Allí verás el mismo panel hermoso que diseñamos antes, pero ahora conectado a una base de datos real local (`devoluciones.db`). Cada vez que un ejecutivo termine el flujo en WhatsApp, el panel se actualizará automáticamente en 10 segundos.
