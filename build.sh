#!/bin/bash

# Asegurarse de estar en el directorio correcto
cd "$(dirname "$0")"

# Instalar dependencias si es necesario
echo "Verificando dependencias..."
npm install

# Crear directorio para iconos si no existe
if [ ! -d "icons" ]; then
  mkdir icons
  
  # Si no tienes un icono, podemos crear uno básico
  if [ ! -f "icons/icon.png" ]; then
    echo "No se encontró un icono. Descargando un icono de WhatsApp..."
    curl -s https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg -o icons/icon.svg
    
    # Convertir SVG a PNG si ImageMagick está instalado
    if command -v convert &> /dev/null; then
      convert -background none icons/icon.svg -resize 512x512 icons/icon.png
      echo "Icono creado en icons/icon.png"
    else
      echo "No se pudo crear el icono PNG. Por favor, añade manualmente un archivo PNG en icons/icon.png"
    fi
  fi
fi

# Optimizar el package.json antes de compilar
cat > package.json << EOL
{
  "name": "whatsapp-endeavouros",
  "version": "1.0.0",
  "description": "Cliente optimizado de WhatsApp para EndeavourOS",
  "main": "main.js",
  "author": {
    "name": "Thiago N.",
    "email": "thiago@example.com"
  },
  "homepage": "https://github.com/tuusuario/WhatsArch",
  "scripts": {
    "start": "electron . --js-flags='--expose-gc'",
    "build": "electron-builder"
  },
  "devDependencies": {
    "electron": "^22.3.0",
    "electron-builder": "^24.9.0"
  },
  "build": {
    "appId": "com.endeavouros.whatsapp",
    "productName": "WhatsApp EndeavourOS",
    "linux": {
      "target": [
        {
          "target": "pacman",
          "arch": "x64"
        },
        "tar.gz",
        "AppImage"
      ],
      "category": "Network;InstantMessaging",
      "icon": "icons/icon.png",
      "desktop": {
        "Name": "WhatsApp EndeavourOS",
        "Comment": "Cliente optimizado de WhatsApp para EndeavourOS",
        "StartupWMClass": "whatsapp-endeavouros"
      },
      "artifactName": "whatsapp-endeavouros-\${version}.\${ext}"
    },
    "pacman": {
      "compression": "xz"
    }
  }
}
EOL


echo "Compilando la aplicación..."
npx electron-builder --linux pacman --x64 --publish never

echo "Compilación completa. Los archivos compilados están en la carpeta dist/"
echo "Para instalar el paquete: sudo pacman -U dist/whatsapp-endeavouros-1.0.0.pacman"