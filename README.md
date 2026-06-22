# 🐜 Hormiga — Finanzas compartidas para parejas

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat&logo=firebase&logoColor=black)
![Capacitor](https://img.shields.io/badge/Capacitor-119EFF?style=flat&logo=capacitor&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?style=flat&logo=android&logoColor=white)

PWA convertida a APK nativa con Capacitor. Registrador de gastos diarios en pesos argentinos con sincronización en tiempo real entre dos usuarios, y un sistema de **presupuesto que reparte los gastos compartidos de forma justa según el ingreso de cada uno**.

---

## 📌 Problema

Administrar la plata en pareja es una fuente clásica de conflicto, y las apps existentes no lo resuelven bien:

- Los que conviven suelen tener **ingresos distintos**, pero las apps de "dividir gastos" reparten 50/50 o por montos fijos — no es justo.
- Las apps de finanzas son **individuales**, no pensadas para dos personas con una economía entrelazada.
- Las planillas de cálculo se desactualizan y son incómodas desde el celular.
- Las soluciones con backend propio implican costos de hosting.

---

## ✅ Solución implementada

App mobile-first instalable como APK (o usable como PWA), diseñada para registrar gastos rápidos ("gastos hormiga") con mínima fricción y entender la economía del hogar:

- **Registro en segundos** con teclado numérico propio, sin abrir el teclado del sistema.
- **Equidad proporcional**: cada uno aporta a los gastos compartidos según su ingreso, no 50/50.
- **Compartido vs personal**: marcás si un gasto es del hogar o tuyo — y el personal del otro no se mezcla ni se muestra.
- **Cuotas, suscripciones (con dólar), ingresos variables y transferencias internas** para tener la foto completa del mes.
- **Categorías propias** con emoji y color, además de las 6 base.
- **Recordatorios diarios** configurables por notificación local.
- **Modo individual**: si lo usás solo, desaparece toda la UI de pareja.
- Sincronización en tiempo real, funciona offline, y **sin costo de hosting** (Firebase Spark).

---

## ⚙️ Tecnologías utilizadas

| Componente | Rol |
|---|---|
| HTML + CSS + JS vanilla | Frontend sin frameworks ni bundler |
| Firebase Auth | Autenticación con email/contraseña + reset por email |
| Firebase Firestore | Base de datos en tiempo real + persistencia offline |
| Capacitor v7 | Empaquetado de la PWA como APK nativa |
| `@capacitor/app` | Manejo del botón atrás de Android |
| `@capacitor/local-notifications` | Recordatorios diarios (locales, sin servidor) |
| dolarapi.com | Cotización del dólar tarjeta para suscripciones en USD |
| Android Studio | Build del APK final |

---

## 🧠 Arquitectura

```
Usuario A (APK/PWA)                 Usuario B (APK/PWA)
      │                                   │
      ▼                                   ▼
  Firebase Auth ──── onAuthStateChanged ───
      │                                   │
      ▼                                   ▼
  /groups/{código}  ← nombres · ingresos fijos · categorías propias
      │
      ├── /expenses        gastos (compartidos + personales)
      ├── /incomes         ingresos variables del mes
      ├── /transfers       transferencias internas entre la pareja
      ├── /installments    cuotas y deudas
      └── /subscriptions   suscripciones (ARS / USD)
      │
      ├── onSnapshot ─────────→ UI en tiempo real
      ├── filtro de privacidad → no se ven los gastos personales del otro
      └── enablePersistence() → funciona offline
```

El cálculo de equidad usa un **modelo proporcional**: el gasto de cada uno se atribuye entre su propio dinero y el recibido por transferencia, en proporción, para comparar qué % de su ingreso aporta cada uno a los gastos compartidos.

---

## ✨ Funcionalidades

### Registro rápido
- Numpad propio con formato `1.000,50` (pesos argentinos).
- Categorías base: 🥤 Kiosko · ⛽ Nafta · 🎮 Digitales · 💖 Transferencias · 🏠 Casa · 💳 Tarjeta.
- Toggle **Compartido / Personal** y nota opcional.
- Fecha y hora local automática (sin desfasaje de zona horaria).

### Presupuesto y equidad proporcional
- Ingreso fijo mensual (opcional) **o ingresos variables** cargables durante el mes.
- Tarjeta por persona: cuánto aportó y qué **% de su ingreso** representa.
- Caja de equidad: muestra si ambos aportan parejo y cuánto falta para emparejar.
- **Transferencias internas**: mover saldo entre la pareja sin generar un gasto.

### Compartido vs personal (con privacidad)
- Cada gasto se marca como del hogar o personal.
- El presupuesto sólo considera los compartidos.
- Los gastos **personales del otro no se muestran ni se descargan** a tu dispositivo.

### Cuotas y deudas
- Qué compraste, en qué entidad, monto por cuota y cantidad.
- Barra de progreso, cuánto pagaste y cuánto falta, botón para marcar cuota paga.
- Resumen: compromiso mensual y deuda total restante.

### Suscripciones
- Nombre, monto, **moneda (ARS / USD)** y día de cobro.
- Conversión automática USD → ARS con el dólar tarjeta.
- Total mensual y anual de lo que se va en servicios.

### Categorías personalizables
- Crear categorías propias con **emoji y color** (se comparten en el grupo).
- Las 6 base no se borran; las propias sí.

### Recordatorios
- Hasta 4 horarios diarios configurables (notificaciones locales, sin servidor ni costo).

### Modo individual
- Si el grupo tiene un solo usuario, se ocultan automáticamente todas las opciones de pareja (equidad, transferencias, compartido/personal).

### Historial y estadísticas
- Gastos agrupados por fecha, con chip de usuario y borde de color por categoría.
- Editar y eliminar (con confirmación).
- Gráfico de torta SVG (sin librerías) por categoría o por persona, con filtros por período.

### Cuenta y grupo
- Registro/login con email, **reset de contraseña por email** y autocompletado del último mail usado.
- Sistema de grupos con código de 6 letras: uno crea, el otro se une.

### Extras
- Menú lateral de accesos en texto.
- Exportar CSV (con BOM para Excel en español).
- Botón atrás de Android con navegación entre pantallas.
- Service Worker *network-first*: las actualizaciones se ven sin reinstalar.

---

## 📁 Estructura del repositorio

```
Hormiga/
├── index.html          ← App principal
├── app.js              ← Lógica: Firebase, UI, sync, presupuesto, stats
├── style.css           ← Diseño dark mode con paleta lime/dark
├── manifest.json       ← PWA manifest
├── sw.js               ← Service Worker (network-first)
├── lib/                ← Firebase SDK local (bundleado en el APK)
│   ├── firebase-app-compat.js
│   ├── firebase-auth-compat.js
│   └── firebase-firestore-compat.js
├── www/                ← Copia de assets para Capacitor
├── capacitor.config.json
├── package.json
└── android/            ← Proyecto Android (generado por Capacitor)
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

> ⚠️ Estas reglas (cualquier usuario autenticado) sirven para **desarrollo**. Para producción conviene restringir el acceso a los miembros de cada grupo.

### Build del APK
```bash
# Instalar dependencias
npm install

# Copiar assets web al proyecto Android y sincronizar
npm run sync

# Abrir Android Studio
npx cap open android

# Desde Android Studio: Build → Build APK(s)
```

---

## 📱 Dispositivo de prueba

Samsung Galaxy S24 FE — Android 14 / One UI 6
