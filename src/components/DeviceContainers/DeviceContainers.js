import React from 'react';

import DesktopContainer from "./Desktop/DesktopContainer";
import TabletContainer from "./Tablet/TabletContainer";
import MobileContainer from "./Mobile/MobileContainer";

const DeviceContainers = ({ projectDetails }) => {
  const { mobile_image, tablet_image, desktop_image } = projectDetails;

  
  return (
    <>
      <MobileContainer mobile_image={mobile_image} />
      <TabletContainer tablet_image={tablet_image} />
      <DesktopContainer desktop_image={desktop_image} />
    </>
  )
}

export default DeviceContainers;
