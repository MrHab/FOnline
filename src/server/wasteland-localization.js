'use strict';

function localizeLegacyWorldText(value = '') {
  let text = String(value || '');
  const replacements = [
    ['Old Klim Supply Caravan', 'Снабженческий караван Старого Клима'],
    ['Old Klim Road Patrol', 'Патруль Старого Клима'],
    ['Road Raider Band', 'Дорожная банда рейдеров'],
    ['Mutant Roamers', 'Бродячие супермутанты'],
    ['Old Klim Caravan Yard', 'Караванный двор Старого Клима'],
    ['Free Caravans', 'Вольные караваны'],
    ['Wasteland Wildlife', 'Дикие твари пустоши'],
    ['Neutral Wastelanders', 'Нейтральные жители пустоши'],
    ['Raider ambush', 'Засада рейдеров'],
    ['Raiders vs patrol', 'Рейдеры против патруля'],
    ['Raiders', 'Рейдеры'],
    ['Mutants', 'Супермутанты'],
    [' delivered supplies to ', ' доставил груз в '],
    [' loaded resources at ', ' загрузился в '],
    [' accumulated resources.', ': накоплены ресурсы.']
  ];
  replacements.forEach(([from, to]) => { text = text.split(from).join(to); });
  return text;
}

module.exports = {
  localizeLegacyWorldText
};
