/** @odoo-module **/

import { registry } from "@web/core/registry"; 

// Constantes
const POS_CLIENT_TAG = "pos.config.action";
const POS_COMPONENT_TAG = "point_of_sale.app";
const actionComponentRegistry = registry.category("action_components");
const actionRegistry = registry.category("actions");

// 1. Registrar la acción cliente para que Odoo sepa qué buscar cuando vea el tag.
actionRegistry.add(POS_CLIENT_TAG, {
    type: "ir.actions.client",
    tag: POS_CLIENT_TAG,
    params: { name: "Forced Offline POS Action" },
}, { sequence: 1000 });

console.log(`🟢 [POS ACTION REGISTRY] Tag '${POS_CLIENT_TAG}' REGISTRADO.`);


// 2. Asegurar que el componente POS esté registrado (el bypass DUMMY).
if (!actionComponentRegistry.contains(POS_COMPONENT_TAG)) {
    console.warn("🚨 FORZANDO REGISTRO (ESM): Componente DUMMY añadido.");
    const DummyComponent = function() {}; 
    actionComponentRegistry.add(POS_COMPONENT_TAG, DummyComponent);
}