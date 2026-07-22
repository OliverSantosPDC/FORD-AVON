# FORD-AVON - Reglas del Proyecto

## Objetivo
Desarrollar una plataforma web para gestión de cobranza.

## Arquitectura

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Arquitectura por capas
- Dashboard independiente del origen de datos

## Origen de datos

Fase 1
- Archivo Excel almacenado en OneDrive

Fase 2
- SQL Server

El Dashboard nunca debe conocer el origen de los datos.

## Desarrollo

- Nunca eliminar archivos existentes.
- Nunca modificar la arquitectura sin autorización.
- Crear componentes reutilizables.
- Documentar los cambios importantes.

## Diseño

Debe verse como una aplicación empresarial moderna.

Inspiración:

- Microsoft Power BI
- Azure Portal
- Microsoft Fabric

- No utilizar colores fuertes.
- Debe ser responsive.

## Módulos

- Login
- Dashboard
- Cartera
- Gestores
- Países
- Reportes
- Importación Excel
- Exportación
- Configuración
- Usuarios

## Flujo

OneDrive

↓

Backend

↓

API

↓

Dashboard

## Objetivo final

Construir una plataforma profesional preparada para crecer durante varios años.
