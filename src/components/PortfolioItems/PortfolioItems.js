import DesktopPortfolioItem from "./Devices/DesktopPortfolioItem";
import TabletPortfolioItem from "./Devices/TabletPortfolioItem";
import MobilePortfolioItem from "./Devices/MobilePortfolioItem";

export const getPortfolioItem = (deviceType) => {
  switch (deviceType) {
    case "desktop":
      return DesktopPortfolioItem;
    case "tablet":
      return TabletPortfolioItem;
    case "mobile":
      return MobilePortfolioItem;
    default:
      return DesktopPortfolioItem;
  }
};
