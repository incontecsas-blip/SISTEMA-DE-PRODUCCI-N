// src/app/produccion/page.tsx

import React from 'react';

const ProduccionPage = () => {
    const nuevosConsumos = [ /* some simulated data */ ];

    return (
        <div>
            <h1>Producción</h1>
            <ul>
                {nuevosConsumos.map((c: typeof nuevosConsumos[0]) => (
                    <li key={c.id}>{c.name}</li>
                ))}
            </ul>
        </div>
    );
};

export default ProduccionPage;