import React, { useState, useEffect } from "react";
import { useHistory, useRouteMatch } from "react-router-dom";
import Project from "../Project/Project";

import { getPortfolioItem } from "../../components/PortfolioItems/PortfolioItems";
import LoadingContainer from "../../components/LoadingContainer/LoadingContainer";
import ErrorComponent from "../../components/ErrorComponent/ErrorComponent";
import Filters from "../../components/Filters/Filters";
import { Container, Grid } from "@material-ui/core";
import useFetch from "../../hooks/useFetch";

import { getFiltersArray } from "../../utils/helpers";

const Portfolio = () => {
  const history = useHistory();
  const routeMatch = useRouteMatch("/portfolio/:id");
  const isExact = routeMatch && routeMatch.isExact;

  const [selectedFilter, setSelectedFilter] = useState(null);
  const [{ data, isLoading, isError, errorData }] = useFetch("projects");

  const [filteredProjects, setFilteredProjects] = useState(data);

  const PortfolioItem = getPortfolioItem("desktop");
  const filterArray = getFiltersArray("primary_technologies");

  useEffect(() => {
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
  }, [data, selectedFilter]);

  const openProjectDialog = (projectInfo) => {
    history.push(`/portfolio/${projectInfo._id}`);
  };

  return (
    <Container>
      {isLoading ? (
        <LoadingContainer />
      ) : isError ? (
        <ErrorComponent errorData={errorData} />
      ) : (
        <>
          <Filters
            selectedFilter={selectedFilter}
            setSelectedFilter={setSelectedFilter}
            filters={filterArray}
          />
          <Grid container spacing={2} justify="flex-start">
            {filteredProjects.map((project) => (
              <PortfolioItem
                key={project._id}
                data={project}
                openProjectDialog={openProjectDialog}
              />
            ))}
          </Grid>
        </>
      )}
      {isExact && <Project />}
    </Container>
  );
};

export default Portfolio;
