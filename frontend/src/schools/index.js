/**
 * School-specific utilities and configurations
 * This module provides utilities for loading school-specific content dynamically
 */

// School configuration loader
export const loadSchoolConfig = async (schoolId) => {
  try {
    const config = await import(`./config/${schoolId}/index.js`);
    return config.default || config;
  } catch (error) {
    console.warn(`No specific config found for school ${schoolId}, using defaults`);
    return {};
  }
};

// School component loader
export const loadSchoolComponent = async (schoolId, componentName) => {
  try {
    const component = await import(`./components/${schoolId}/${componentName}.jsx`);
    return component.default || component;
  } catch (error) {
    console.warn(`No specific component ${componentName} found for school ${schoolId}`);
    return null;
  }
};

// School asset loader
export const getSchoolAsset = (schoolId, assetName) => {
  return `/schools/${schoolId}/assets/${assetName}`;
};

// School data loader
export const loadSchoolData = async (schoolId, dataName) => {
  try {
    const data = await import(`./data/${schoolId}/${dataName}.js`);
    return data.default || data;
  } catch (error) {
    console.warn(`No specific data ${dataName} found for school ${schoolId}`);
    return null;
  }
};

// Utility to get normalized school folder name
export const getSchoolFolderName = (schoolId) => {
  return `school-${schoolId}`;
};

// Utility to check if school has custom content
export const hasSchoolSpecificContent = async (schoolId, type) => {
  try {
    switch (type) {
      case 'config':
        await import(`./config/${schoolId}/index.js`);
        return true;
      case 'components':
        // Check if the components folder exists
        const response = await fetch(`/schools/${schoolId}/components/`);
        return response.ok;
      case 'assets':
        const assetResponse = await fetch(`/schools/${schoolId}/assets/`);
        return assetResponse.ok;
      default:
        return false;
    }
  } catch (error) {
    return false;
  }
};

export default {
  loadSchoolConfig,
  loadSchoolComponent,
  getSchoolAsset,
  loadSchoolData,
  getSchoolFolderName,
  hasSchoolSpecificContent
};