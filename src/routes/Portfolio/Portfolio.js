import React, { useState, useEffect } from "react";
import { useHistory, useRouteMatch } from "react-router-dom";
import Project from "../Project/Project";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import { useTheme } from "@material-ui/core/styles";
import useMediaQuery from "@material-ui/core/useMediaQuery";

import LoadingContainer from "../../components/LoadingContainer/LoadingContainer";
import PortfolioItems from "../../components/PortfolioItems/PortfolioItems";
import ErrorComponent from "../../components/ErrorComponent/ErrorComponent";
import Filters from "../../components/Filters/Filters";
import useFetch from "../../hooks/useFetch";

import { getFiltersArray } from "../../utils/helpers";

const Portfolio = () => {
  const history = useHistory();
  const routeMatch = useRouteMatch("/portfolio/:id");
  const isExact = routeMatch && routeMatch.isExact;
  const [selectedFilter, setSelectedFilter] = useState(null);
  const [{ data, isLoading, isError, errorData }] = useFetch("projects");

  const [filteredProjects, setFilteredProjects] = useState(
    data.sort((a, b) => (a.year_built < b.year_built ? 1 : -1))
  );

  const filterArray = getFiltersArray("primary_technologies");
  const theme = useTheme();
  const matchDesktop = useMediaQuery(theme.breakpoints.up("md"));

  useEffect(() => {
    setFilteredProjects([]);
    setTimeout(() => {
      setFilteredProjects(
        selectedFilter
          ? [
              ...data.filter(
                (a) =>
                  a.primary_technologies.includes(selectedFilter) ||
                  a.secondary_technologies.includes(selectedFilter)
              ),
            ]
          : [...data]
      );
    }, 250);
  }, [data, selectedFilter]);

  const openProjectDialog = (projectInfo) => {
    history.push(`/portfolio/${projectInfo._id}`);
  };

  return (
    <Grid container item xs={12} justify="center">
      <Typography gutterBottom={true} variant="h3">
        Sites Built
      </Typography>
      {isLoading ? (
        <LoadingContainer />
      ) : isError ? (
        <ErrorComponent errorData={errorData} />
      ) : (
        <>
          {matchDesktop && (
            <Filters
              selectedFilter={selectedFilter}
              setSelectedFilter={setSelectedFilter}
              filters={filterArray}
            />
          )}
          <Grid container spacing={2} justify="flex-start">
            {filteredProjects.map(
              (project, index) =>
                project.active && (
                  <PortfolioItems
                    key={project._id}
                    index={index}
                    data={project}
                    openProjectDialog={openProjectDialog}
                  />
                )
            )}
          </Grid>
        </>
      )}
      {isExact && <Project />}
    </Grid>
  );
};

export default Portfolio;
