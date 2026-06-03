# 🐜 Hormiga — Registro de gastos compartido

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat&logo=firebase&logoColor=black)
![Capacitor](https://img.shields.io/badge/Capacitor-119EFF?style=flat&logo=capacitor&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?style=flat&logo=android&logoColor=white)

PWA convertida a APK nativa con Capacitor. Registrador de gastos diarios en pesos argentinos con sincronización en tiempo real entre dos usuarios, historial compartido y estadísticas visuales.

---

## 📌 Problema

Llevar un registro compartido de gastos con otra persona es difícil cuando:

- Cada uno usa su propio teléfono y no hay sincronización
- Las apps de finanzas existentes son complejas para gastos pequeños del día a día
- Los registros en hojas de cálculo se desactualizan o son difíciles de usar desde el celular
- Las soluciones con backend propio implican costos de hosting

---

## ✅ Solución implementada

Aplicación mobile-first instalable como APK, diseñada para registrar gastos rápidos ("gastos hormiga") con mínima fricción:

- Teclado numérico propio, sin necesidad de abrir el teclado del sistema
- 6 categorías con emoji para clasificar de un toque
- Sincronización en tiempo real entre dos dispositivos vía Firebase Firestore
- Historial compartido con identificación por usuario
- Estadísticas con gráfico de torta por categoría o por persona
- Funciona offline — los cambios se sincronizan cuando vuelve la conexión
- Sistema de grupos con código de 6 letras: uno crea, el otro se une
- **Sin costo de hosting** — Firebase Spark (gratuito)

---

## ⚙️ Tecnologías utilizadas

| Componente | Rol |
|---|---|
| HTML + CSS + JS vanilla | Frontend sin frameworks ni bundler |
| Firebase Auth | Autenticación con email y contraseña |
| Firebase Firestore | Base de datos en tiempo real + persistencia offline |
| Capacitor v7 | Empaquetado de la PWA como APK nativa |
| Android Studio | Build del APK final |

---

## 🧠 Arquitectura

```
Usuario A (APK)                    Usuario B (APK)
     │                                  │
     ▼                                  ▼
Firebase Auth ──── onAuthStateChanged ─────
     │                                  │
     ▼                                  ▼
Firestore /groups/{código}   ←──────────┘
     │
     ▼
Firestore /expenses (filtrado por groupId)
     │
     ├─── onSnapshot ──→ renderHistory() en tiempo real
     │
     └─── enablePersistence() ──→ funciona offline
```

---

## ✨ Funcionalidades

### Registro rápido
- Numpad propio con formato `1.000,50` (pesos argentinos)
- Categorías: 🥤 Kiosko · ⛽ Nafta · 🎮 Digitales · 💖 Transferencias · 🏠 Casa · 💳 Tarjeta
- Nota opcional hasta 80 caracteres
- Fecha y hora local automática (sin desfasaje de zona horaria)

### Historial compartido
- Gastos agrupados por fecha
- Chip de usuario que identifica quién registró cada gasto
- Borde de color por categoría en cada ítem
- Eliminación por long press
- Resumen: total del mes y total general con contador de gastos

### Estadísticas
- Gráfico de torta SVG (sin librerías externas)
- Vista por categoría o por persona
- Filtros: este mes / mes anterior / todo el historial
- Leyenda con barra de progreso proporcional al gasto

### Sistema de grupos
- Al registrarse, el usuario crea un grupo → obtiene un código de 6 letras
- Comparte el código con su pareja → ella se une desde su dispositivo
- Ambos ven y registran gastos en el mismo historial en tiempo real

### Extras
- Exportar CSV (con BOM para Excel en español)
- Modal de configuración: cambiar nombre de usuario, cerrar sesión
- Acceso rápido desde Quick Settings Tile y App Shortcut (Android)

---

## 📁 Estructura del repositorio

```
Hormiga/
├── index.html          ← App principal
├── app.js              ← Lógica: Firebase, UI, sync, stats
├── style.css           ← Diseño dark mode con paleta lime/dark
├── manifest.json       ← PWA manifest
├── sw.js               ← Service Worker
├── lib/                ← Firebase SDK local (bundleado en el APK)
│   ├── firebase-app-compat.js
│   ├── firebase-auth-compat.js
│   └── firebase-firestore-compat.js
├── www/                ← Copia de assets para Capacitor
├── capacitor.config.json
├── package.json
└── android/            ← Proyecto Android (generado por Capacitor)
    └── app/src/main/
        ├── java/com/benja/hormiga/
        │   ├── MainActivity.java
        │   ├── QuickAddActivity.java   ← Overlay flotante nativo
        │   ├── HormigaPlugin.java      ← Plugin Capacitor
        │   └── QuickAddTileService.java
        └── AndroidManifest.xml
```

---

## 🚀 Setup

### Requisitos
- Node.js
- Android Studio con SDK instalado
- Proyecto Firebase (Firestore + Authentication habilitados)

### Configuración Firebase
1. Crear proyecto en [console.firebase.google.com](https://console.firebase.google.com)
2. Habilitar Authentication → Email/Contraseña
3. Habilitar Firestore Database
4. Pegar las credenciales en `app.js` → `firebaseConfig`
5. Publicar reglas de seguridad en Firestore:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Build del APK
```bash
# Copiar assets web al proyecto Android y sincronizar
npm run sync

# Abrir Android Studio
npx cap open android

# Desde Android Studio: Build → Build APK(s)
```

---

## 📱 Dispositivo de prueba

Samsung Galaxy S24 FE — Android 14 / One UI 6
