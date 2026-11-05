<?php
// Copie este ficheiro para config.php se precisar de alterar a localização da base de dados.
// Recomendado: colocar a base de dados FORA da pasta pública (ex.: public_html),
// sobretudo se o servidor for nginx (não lê ficheiros .htaccess).
return [
    'db_path' => __DIR__ . '/../fct-dados/fct.sqlite',
];
