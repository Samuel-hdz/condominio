import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ComprobanteGenerator {

    /**
     * Generar comprobante PDF
     */
    static async generateComprobante(comprobanteData, pagosAplicados = []) {
        return new Promise(async (resolve, reject) => {
            try {
                const datos = await this.prepararDatosComprobante(comprobanteData, pagosAplicados);

                const comprobantesDir = path.join(__dirname, '../../uploads/comprobantes-finales');
                if (!fs.existsSync(comprobantesDir)) {
                    fs.mkdirSync(comprobantesDir, { recursive: true });
                }

                const fileName = `comprobante-${datos.folio.replace(/\//g, '-')}.pdf`;
                const filePath = path.join(comprobantesDir, fileName);

                const doc = new PDFDocument({ size: 'A4', margin: 50 });
                const writeStream = fs.createWriteStream(filePath);

                doc.pipe(writeStream);

                await this.disenarComprobante(doc, datos);

                doc.end();

                writeStream.on('finish', () => {
                    resolve({
                        path: filePath,
                        url: `/uploads/comprobantes-finales/${fileName}`,
                        fileName,
                        folio: datos.folio
                    });
                });

                writeStream.on('error', reject);

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Preparar datos
     */
    static async prepararDatosComprobante(comprobanteData, pagosAplicados) {
        const comprobante = comprobanteData.toObject ? comprobanteData.toObject() : comprobanteData;

        const totalPagado = pagosAplicados.reduce((sum, pago) => {
            const p = pago.toObject ? pago.toObject() : pago;
            return sum + (p.monto_aplicado || 0);
        }, 0);

        const formatDate = (date) => {
            if (!date) return 'N/A';
            return new Date(date).toLocaleDateString('es-MX', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        };

        const residente = comprobante.residente_id || {};
        const user = residente.user_id || {};
        const domicilio = residente.domicilio_id || {};
        const calle = domicilio.calle_torre_id || {};

        let aprobadoPor = 'Administrador';
        if (comprobante.usuario_aprobador_id?.nombre) {
            aprobadoPor = `${comprobante.usuario_aprobador_id.nombre} ${comprobante.usuario_aprobador_id.apellido || ''}`.trim();
        }

        return {
            folio: comprobante.folio || 'SN',
            fecha_emision: formatDate(new Date()),
            fecha_pago: formatDate(comprobante.fecha_pago),
            residente: {
                nombre: `${user.nombre || ''} ${user.apellido || ''}`.trim() || 'N/A',
                domicilio: calle.nombre && domicilio.numero
                    ? `${calle.nombre} ${domicilio.numero}`
                    : 'N/A',
                email: user.email || 'N/A'
            },
            pagos: pagosAplicados.map(p => {
                const pago = p.toObject ? p.toObject() : p;
                const cargo = pago.cargo_domicilio_id?.cargo_id || {};
                return {
                    concepto: cargo.nombre || 'Pago aplicado',
                    monto: pago.monto_aplicado || 0
                };
            }),
            total_pagado: totalPagado || comprobante.monto_total || 0,
            metodo_pago: this.translatePaymentMethod(comprobante.metodo_pago),
            referencia: comprobante.numero_referencia || 'N/A',
            institucion: comprobante.institucion_bancaria || 'N/A',
            aprobado_por: aprobadoPor,
            notas: comprobante.observaciones || ''
        };
    }

    /**
     * Diseñar PDF (CORREGIDO)
     */
    static async disenarComprobante(doc, datos) {

        // ===== ENCABEZADO =====
        doc.font('Helvetica-Bold')
            .fontSize(20)
            .text('COMPROBANTE DE PAGO', { align: 'center' });

        doc.moveDown(0.5);

        doc.strokeColor('#333')
            .lineWidth(1)
            .moveTo(50, doc.y)
            .lineTo(550, doc.y)
            .stroke();

        doc.moveDown(1);

        // ===== INFO COMPROBANTE =====
        doc.font('Helvetica')
            .fontSize(10)
            .text(`Fecha de emisión: ${datos.fecha_emision}`, { continued: true })
            .text(`Folio: ${datos.folio}`, { align: 'right' });

        doc.text(`Fecha de pago: ${datos.fecha_pago}`);
        doc.moveDown();

        // ===== RESIDENTE =====
        doc.font('Helvetica-Bold').fontSize(12).text('DATOS DEL RESIDENTE');
        doc.font('Helvetica').fontSize(10);
        doc.text(`Nombre: ${datos.residente.nombre}`);
        doc.text(`Domicilio: ${datos.residente.domicilio}`);
        doc.text(`Email: ${datos.residente.email}`);
        doc.moveDown();

        // ===== DETALLE PAGOS =====
        doc.font('Helvetica-Bold').fontSize(12).text('DETALLE DE PAGO');
        doc.moveDown(0.5);

        let y = doc.y;

        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('Concepto', 50, y);
        doc.text('Monto', 400, y, { width: 100, align: 'right' });

        y += 15;

        doc.strokeColor('#000')
            .lineWidth(1)
            .moveTo(50, y)
            .lineTo(550, y)
            .stroke();

        doc.font('Helvetica').fontSize(10);
        y += 10;

        for (const pago of datos.pagos) {
            doc.text(pago.concepto.substring(0, 45), 50, y, { width: 300 });
            doc.text(this.formatCurrency(pago.monto), 400, y, {
                width: 100,
                align: 'right'
            });
            y += 20;
        }

        // ===== TOTAL =====
        y += 10;

        doc.strokeColor('#333')
            .lineWidth(2)
            .moveTo(400, y)
            .lineTo(550, y)
            .stroke();

        y += 10;

        doc.font('Helvetica-Bold').fontSize(12);
        doc.text('TOTAL PAGADO:', 400, y, { continued: true });
        doc.text(this.formatCurrency(datos.total_pagado), { align: 'right' });

        // ===== INFO EXTRA =====
        y += 30;
        doc.font('Helvetica').fontSize(10);
        doc.text(`Método de pago: ${datos.metodo_pago}`, 50, y);
        y += 15;
        doc.text(`Referencia: ${datos.referencia}`, 50, y);
        y += 15;
        doc.text(`Institución: ${datos.institucion}`, 50, y);
        y += 20;
        doc.text(`Aprobado por: ${datos.aprobado_por}`, 50, y);

        if (datos.notas) {
            y += 20;
            doc.text(`Observaciones: ${datos.notas.substring(0, 100)}`, 50, y, { width: 500 });
        }

        // ===== FOOTER =====
        doc.fontSize(8)
            .fillColor('#666')
            .text(
                'Documento generado automáticamente por el sistema de administración.',
                50,
                750,
                { align: 'center', width: 500 }
            );
    }

    static formatCurrency(amount) {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount);
    }

    static translatePaymentMethod(method) {
        const map = {
            transferencia: 'Transferencia Bancaria',
            deposito: 'Depósito',
            efectivo: 'Efectivo',
            tarjeta: 'Tarjeta',
            cheque: 'Cheque'
        };
        return map[method] || method || 'N/A';
    }
}

export default ComprobanteGenerator;
